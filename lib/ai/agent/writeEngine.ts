/**
 * Ferramentas de ESCRITA do agente: propor e confirmar operações financeiras
 * (pagar uma conta, lançar uma despesa ou receita, aportar num investimento,
 * adicionar item a uma lista).
 *
 * Duas fases obrigatórias — nunca uma só:
 *
 *   1. `propor_*`  — não grava nada definitivo. Resolve o alvo por busca
 *      tolerante sobre o dataset já carregado (mesma função de matching das
 *      consultas), monta o payload exato que seria gravado e guarda tudo em
 *      `chat_operacoes` com status 'pendente'. Devolve um resumo em texto
 *      para o modelo repassar ao usuário e pedir confirmação — SEM executar
 *      a escrita.
 *   2. `confirmar_operacao` / `cancelar_operacao` — agem só sobre a operação
 *      pendente mais recente desta conversa. Não recebem valores do modelo:
 *      o que é gravado é exatamente o payload já salvo na etapa 1, para que
 *      uma segunda chamada do modelo (inclusive a partir de uma transcrição
 *      de voz malformada) não possa trocar o valor por outro.
 *
 * `confirmar_operacao` também é bloqueada quando a proposta foi feita NESTA
 * MESMA rodada do agente (ver `propostaNesteTurno` em runAgent.ts): confirmar
 * só pode valer depois que o usuário respondeu, numa mensagem seguinte —
 * nunca no mesmo turno em que o modelo acabou de propor.
 *
 * LOTES: várias operações de uma vez ("paguei luz 150, água 80 e internet
 * 100", uma lista de mercado inteira) viram UMA operação pendente do tipo
 * 'lote', com as operações individuais dentro do payload. Assim continua
 * havendo uma única pendente por conversa — um "sim" confirma o lote todo, e
 * um "não" descarta o lote todo. Um lote nasce de `propor_lote` (todos os
 * itens numa chamada só) ou da soma de vários propor_* feitos na mesma
 * resposta (ver `combinarPropostas`).
 */

import { format } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnrichedData } from '../types'
import { casaBusca, distanciaEdicao, normalizar, normalizarMes, type Referencias } from './queryEngine'
import { formatBRL } from '../../format'

// Sessão do usuário (app) ou service role (webhook do Telegram).
type Supabase = SupabaseClient

const R = formatBRL
const RECEITA_PREFIXO = '[RECEITA] '
const fmtDataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

// `planejamento.responsavel` (e as demais tabelas com essa coluna) tem CHECK
// restrito a estes três valores — um responsavel fora daqui não é "sem
// filtro", é um INSERT que a auditoria de negócio jamais quer aceitar:
// falharia na gravação com um erro de constraint em vez de um aviso claro.
const RESPONSAVEIS_VALIDOS = ['Matheus', 'Jeniffer', 'Conjunto']

/** Casa o texto do modelo com um dos três valores válidos, tolerando acento/caixa. */
function resolverResponsavel(pedido: string | undefined, padrao: string): string | { erro: string } {
  const valor = pedido?.trim() || padrao
  const achado = RESPONSAVEIS_VALIDOS.find(r => normalizar(r) === normalizar(valor))
  return achado ?? { erro: `Responsável "${valor}" não é válido. Use um destes: ${RESPONSAVEIS_VALIDOS.join(', ')}.` }
}

function dataValida(valor: unknown, padrao: Date): string {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10)
  return format(padrao, 'yyyy-MM-dd')
}

export interface ContextoEscrita {
  supabase: Supabase
  conversationId: string
  /** E-mail do usuário logado, só para auditoria (activity_logs / criado_por). */
  usuario: string | null
  /**
   * Responsável que corresponde ao usuário logado (ex.: "Matheus"). É o padrão
   * de despesas e receitas novas quando ele não diz de quem são — "lança uma
   * conta de 120" fala na primeira pessoa.
   */
  responsavelPadrao?: string | null
}

export type PropostaOk = { ok: true; tipo: string; payload: Record<string, unknown>; resumo: string }
export type Proposta = PropostaOk | { ok: false; mensagem: string }

/** Uma operação individual dentro de um lote (mesmo formato de uma pendente avulsa). */
interface OperacaoDoLote {
  tipo: string
  payload: Record<string, unknown>
  resumo: string
}

const falha = (mensagem: string): Proposta => ({ ok: false, mensagem })

// ─── propor_* : resolvem o alvo e montam o payload, sem gravar nada ──────────

export function proporPagamento(data: EnrichedData, refs: Referencias, a: {
  busca?: string; valorPago?: number; dataPagamento?: string; mes?: string; responsavel?: string
}): Proposta {
  const busca = a.busca?.trim()
  if (!busca) return falha('Informe o nome (ou parte do nome) da despesa a pagar.')
  if (!a.valorPago || a.valorPago <= 0) return falha('Informe o valor pago, maior que zero.')

  const mes = normalizarMes(a.mes)
  const candidatos = data.planejamento.filter(p =>
    !p.pago &&
    !normalizar(p.item ?? '').startsWith(normalizar(RECEITA_PREFIXO)) &&
    casaBusca(p.item ?? '', busca) &&
    (!mes || (p.mes_referencia ?? '').substring(0, 7) === mes) &&
    (!a.responsavel || normalizar(p.responsavel ?? '') === normalizar(a.responsavel))
  )

  if (candidatos.length === 0) {
    return falha(`Não encontrei nenhuma despesa EM ABERTO parecida com "${busca}"${mes ? ` em ${mes}` : ''}. Confira o nome exato com consultar_planejamento antes de tentar de novo.`)
  }
  if (candidatos.length > 1) {
    const opcoes = candidatos.slice(0, 6)
      .map(c => `"${c.item}" (${c.responsavel ?? 'sem responsável'}, ${(c.mes_referencia ?? '').substring(0, 7)}, ${R(c.valor_previsto)})`)
      .join('; ')
    return falha(`Mais de uma despesa em aberto casa com "${busca}": ${opcoes}. Peça ao usuário para especificar melhor (nome, mês ou responsável) e chame de novo.`)
  }

  const item = candidatos[0]
  if (!item.id) return falha('Essa despesa não tem um identificador utilizável por aqui — oriente o usuário a pagar pela tela de Finanças.')

  const dataPagamento = dataValida(a.dataPagamento, refs.hoje)
  const diffPrevisto = Math.abs(a.valorPago - item.valor_previsto) > 0.01
    ? ` (previsto era ${R(item.valor_previsto)})`
    : ''

  return {
    ok: true,
    tipo: 'pagamento',
    payload: { id: item.id, valor_real: a.valorPago, data_pagamento: dataPagamento },
    resumo: `Marcar "${item.item}" (${item.responsavel ?? 'sem responsável'}) como PAGA: ${R(a.valorPago)} em ${fmtDataBR(dataPagamento)}${diffPrevisto}`,
  }
}

export function proporNovaDespesa(refs: Referencias, a: {
  descricao?: string; valor?: number; categoria?: string; responsavel?: string
  dataVencimento?: string; mes?: string
}, responsavelPadrao = 'Matheus'): Proposta {
  const descricao = a.descricao?.trim()
  if (!descricao) return falha('Informe a descrição da despesa.')
  if (!a.valor || a.valor <= 0) return falha('Informe um valor maior que zero.')

  const mes = normalizarMes(a.mes) ?? refs.mesApp
  const responsavelResolvido = resolverResponsavel(a.responsavel, responsavelPadrao)
  if (typeof responsavelResolvido !== 'string') return falha(responsavelResolvido.erro)
  const responsavel = responsavelResolvido
  const categoria = a.categoria?.trim() || 'Extra'
  const dataVencimento = a.dataVencimento && /^\d{4}-\d{2}-\d{2}/.test(a.dataVencimento) ? a.dataVencimento.slice(0, 10) : null

  return {
    ok: true,
    tipo: 'nova_despesa',
    payload: {
      mes_referencia: `${mes}-01`,
      item: descricao,
      responsavel,
      categoria,
      valor_previsto: a.valor,
      data_vencimento: dataVencimento,
    },
    resumo: `Nova despesa em ${mes}: "${descricao}" — ${R(a.valor)}, categoria ${categoria}, responsável ${responsavel}` +
      (dataVencimento ? `, vence ${fmtDataBR(dataVencimento)}` : ', sem vencimento definido'),
  }
}

export function proporNovaReceita(refs: Referencias, a: {
  descricao?: string; valor?: number; responsavel?: string; mes?: string
}, responsavelPadrao = 'Matheus'): Proposta {
  const descricao = a.descricao?.trim()
  if (!descricao) return falha('Informe a descrição da receita.')
  if (!a.valor || a.valor <= 0) return falha('Informe um valor maior que zero.')

  const mes = normalizarMes(a.mes) ?? refs.mesApp
  const responsavelResolvido = resolverResponsavel(a.responsavel, responsavelPadrao)
  if (typeof responsavelResolvido !== 'string') return falha(responsavelResolvido.erro)
  const responsavel = responsavelResolvido

  return {
    ok: true,
    tipo: 'nova_receita',
    payload: {
      mes_referencia: `${mes}-01`,
      item: `${RECEITA_PREFIXO}${descricao}`,
      responsavel,
      categoria: 'Extra',
      valor_previsto: a.valor,
    },
    resumo: `Nova receita em ${mes}: "${descricao}" — ${R(a.valor)}, responsável ${responsavel}`,
  }
}

export function proporRecebimento(data: EnrichedData, refs: Referencias, a: {
  busca?: string; valor?: number; dataRecebimento?: string; mes?: string; responsavel?: string
}): Proposta {
  const busca = a.busca?.trim()
  if (!busca) return falha('Informe o nome (ou parte do nome) da receita.')
  if (!a.valor || a.valor <= 0) return falha('Informe o valor recebido, maior que zero.')

  const mes = normalizarMes(a.mes)
  const candidatos = data.planejamento.filter(p =>
    (p.item ?? '').startsWith(RECEITA_PREFIXO) &&
    casaBusca((p.item ?? '').replace(RECEITA_PREFIXO, ''), busca) &&
    (!mes || (p.mes_referencia ?? '').substring(0, 7) === mes) &&
    (!a.responsavel || normalizar(p.responsavel ?? '') === normalizar(a.responsavel))
  )

  if (candidatos.length === 0) {
    return falha(`Não encontrei nenhuma receita parecida com "${busca}"${mes ? ` em ${mes}` : ''}. Confira o nome com consultar_receitas, ou use propor_nova_receita se ela ainda não existe.`)
  }
  if (candidatos.length > 1) {
    const opcoes = candidatos.slice(0, 6)
      .map(c => `"${(c.item ?? '').replace(RECEITA_PREFIXO, '')}" (${c.responsavel ?? 'sem responsável'}, ${(c.mes_referencia ?? '').substring(0, 7)})`)
      .join('; ')
    return falha(`Mais de uma receita casa com "${busca}": ${opcoes}. Peça para especificar melhor e chame de novo.`)
  }

  const item = candidatos[0]
  if (!item.id) return falha('Essa receita não tem um identificador utilizável por aqui — oriente o usuário a registrar pela tela de Receitas.')

  const dataRecebimento = dataValida(a.dataRecebimento, refs.hoje)
  return {
    ok: true,
    tipo: 'recebimento',
    payload: { planejamento_id: item.id, valor: a.valor, data_recebimento: dataRecebimento },
    resumo: `Registrar recebimento de "${(item.item ?? '').replace(RECEITA_PREFIXO, '')}": ${R(a.valor)} em ${fmtDataBR(dataRecebimento)}`,
  }
}

export function proporAporteInvestimento(data: EnrichedData, refs: Referencias, a: {
  busca?: string; valor?: number; dataAporte?: string; saldoAtual?: number; observacao?: string
}): Proposta {
  const busca = a.busca?.trim()
  if (!busca) return falha('Informe o nome do investimento.')
  if (!a.valor || a.valor <= 0) return falha('Informe um valor de aporte maior que zero.')

  const candidatos = data.investimentos.filter(i => casaBusca(i.descricao, busca))
  const nomesUnicos = [...new Set(candidatos.map(c => normalizar(c.descricao)))]

  if (nomesUnicos.length === 0) {
    return falha(`Não encontrei nenhum investimento parecido com "${busca}". Confira com consultar_investimentos — se ele ainda não existe, avise que é preciso cadastrá-lo primeiro na tela de Investimentos (essa criação não está disponível por aqui).`)
  }
  if (nomesUnicos.length > 1) {
    const opcoes = [...new Set(candidatos.map(c => c.descricao))].slice(0, 6).join(', ')
    return falha(`Mais de um investimento casa com "${busca}": ${opcoes}. Peça para especificar melhor.`)
  }

  // Um nome só, possivelmente repetido mês a mês: usa a ocorrência mais recente.
  const escolhido = [...candidatos].sort((x, y) => (y.mes_referencia ?? '').localeCompare(x.mes_referencia ?? ''))[0]
  const dataAporte = dataValida(a.dataAporte, refs.hoje)
  const saldoValido = typeof a.saldoAtual === 'number' && a.saldoAtual >= 0 ? a.saldoAtual : null

  return {
    ok: true,
    tipo: 'aporte_investimento',
    payload: {
      investimento_id: escolhido.id,
      valor: a.valor,
      data_aporte: dataAporte,
      saldo_atual: saldoValido,
      observacao: a.observacao?.trim() || null,
    },
    resumo: `Aporte de ${R(a.valor)} em "${escolhido.descricao}" em ${fmtDataBR(dataAporte)}` +
      (saldoValido !== null ? ` (novo saldo informado: ${R(saldoValido)})` : ''),
  }
}

export function proporItemMercado(a: { nome?: string; quantidade?: number }): Proposta {
  const nome = a.nome?.trim()
  if (!nome) return falha('Informe o nome do item.')
  const quantidade = a.quantidade && a.quantidade > 0 ? Math.round(a.quantidade) : 1

  return {
    ok: true,
    tipo: 'item_mercado',
    payload: { nome, quantidade },
    resumo: `Adicionar à lista de mercado: "${nome}"${quantidade > 1 ? ` (quantidade ${quantidade})` : ''}`,
  }
}

const PRIORIDADES_WISHLIST = new Set(['alta', 'media', 'baixa'])

export function proporItemWishlist(a: {
  nome?: string; valorEstimado?: number; categoria?: string; prioridade?: string
}): Proposta {
  const nome = a.nome?.trim()
  if (!nome) return falha('Informe o nome do item.')
  const prioridade = a.prioridade && PRIORIDADES_WISHLIST.has(a.prioridade) ? a.prioridade : 'media'
  const valorEstimado = typeof a.valorEstimado === 'number' && a.valorEstimado > 0 ? a.valorEstimado : null

  return {
    ok: true,
    tipo: 'item_wishlist',
    payload: { nome, valor_estimado: valorEstimado, categoria: a.categoria?.trim() || null, prioridade },
    resumo: `Adicionar à wishlist: "${nome}"` +
      (valorEstimado ? ` — ${R(valorEstimado)}` : '') +
      (a.categoria ? `, categoria ${a.categoria.trim()}` : '') +
      `, prioridade ${prioridade}`,
  }
}

// ─── Lote: várias operações numa única proposta ──────────────────────────────

/** Teto de itens num lote — acima disso o resumo deixa de ser conferível. */
export const MAX_ITENS_LOTE = 50

export const TIPOS_ITEM_LOTE = [
  'pagamento', 'nova_despesa', 'recebimento', 'nova_receita', 'aporte_investimento', 'item_mercado', 'item_wishlist',
] as const

/** Um item de `propor_lote`, já com os argumentos convertidos pelo despachante. */
export interface ItemLote {
  tipo?: string
  nome?: string
  valor?: number
  quantidade?: number
  categoria?: string
  responsavel?: string
  data?: string
  mes?: string
  prioridade?: string
  saldoAtual?: number
  observacao?: string
}

function proporItemDoLote(data: EnrichedData, refs: Referencias, item: ItemLote, responsavelPadrao?: string): Proposta {
  switch (item.tipo) {
    case 'pagamento':
      return proporPagamento(data, refs, {
        busca: item.nome, valorPago: item.valor, dataPagamento: item.data, mes: item.mes, responsavel: item.responsavel,
      })
    case 'nova_despesa':
      return proporNovaDespesa(refs, {
        descricao: item.nome, valor: item.valor, categoria: item.categoria, responsavel: item.responsavel,
        dataVencimento: item.data, mes: item.mes,
      }, responsavelPadrao)
    case 'recebimento':
      return proporRecebimento(data, refs, {
        busca: item.nome, valor: item.valor, dataRecebimento: item.data, mes: item.mes, responsavel: item.responsavel,
      })
    case 'nova_receita':
      return proporNovaReceita(refs, {
        descricao: item.nome, valor: item.valor, responsavel: item.responsavel, mes: item.mes,
      }, responsavelPadrao)
    case 'aporte_investimento':
      return proporAporteInvestimento(data, refs, {
        busca: item.nome, valor: item.valor, dataAporte: item.data, saldoAtual: item.saldoAtual, observacao: item.observacao,
      })
    case 'item_mercado':
      return proporItemMercado({ nome: item.nome, quantidade: item.quantidade })
    case 'item_wishlist':
      return proporItemWishlist({
        nome: item.nome, valorEstimado: item.valor, categoria: item.categoria, prioridade: item.prioridade,
      })
    default:
      return falha(`Tipo "${item.tipo ?? ''}" inválido. Use um destes: ${TIPOS_ITEM_LOTE.join(', ')}.`)
  }
}

/** As operações individuais de uma proposta — a própria, ou as de dentro de um lote. */
function operacoesDe(p: PropostaOk): OperacaoDoLote[] {
  if (p.tipo === 'lote') return (p.payload.operacoes as OperacaoDoLote[] | undefined) ?? []
  return [{ tipo: p.tipo, payload: p.payload, resumo: p.resumo }]
}

const ROTULO_TOTAL: Record<string, string> = {
  pagamento: 'pagamentos',
  nova_despesa: 'despesas novas',
  recebimento: 'recebimentos',
  nova_receita: 'receitas novas',
  aporte_investimento: 'aportes',
  item_wishlist: 'wishlist',
}

function valorDaOperacao(op: OperacaoDoLote): number | undefined {
  const p = op.payload
  if (typeof p.valor_real === 'number') return p.valor_real
  if (typeof p.valor_previsto === 'number') return p.valor_previsto
  if (typeof p.valor === 'number') return p.valor
  if (typeof p.valor_estimado === 'number') return p.valor_estimado
  return undefined
}

function resumoLote(operacoes: OperacaoDoLote[]): string {
  const totais = new Map<string, number>()
  for (const op of operacoes) {
    const valor = valorDaOperacao(op)
    const rotulo = ROTULO_TOTAL[op.tipo]
    if (valor !== undefined && rotulo) totais.set(rotulo, (totais.get(rotulo) ?? 0) + valor)
  }
  const linhas = operacoes.map((op, i) => `${i + 1}. ${op.resumo}`)
  const total = [...totais].map(([rotulo, valor]) => `${rotulo} ${R(valor)}`).join(' · ')
  return `Lote com ${operacoes.length} operações:\n${linhas.join('\n')}` + (total ? `\nTotais: ${total}` : '')
}

/**
 * Junta propostas numa só. Uma proposta sozinha continua como está; duas ou
 * mais (inclusive lotes) viram um único lote com todas as operações achatadas.
 */
export function combinarPropostas(propostas: PropostaOk[]): PropostaOk {
  if (propostas.length === 1) return propostas[0]
  const operacoes = propostas.flatMap(operacoesDe)
  return { ok: true, tipo: 'lote', payload: { operacoes }, resumo: resumoLote(operacoes) }
}

/**
 * Prepara várias operações de uma vez. Tudo ou nada: se qualquer item falhar
 * (despesa não encontrada, ambígua, valor faltando), nada é preparado e a
 * resposta lista o problema de cada item — senão o usuário confirmaria um lote
 * achando que ele tem tudo o que pediu.
 */
export function proporLote(data: EnrichedData, refs: Referencias, itens: ItemLote[], responsavelPadrao?: string): Proposta {
  if (itens.length === 0) return falha('Informe pelo menos um item no lote.')
  if (itens.length > MAX_ITENS_LOTE) {
    return falha(`O lote tem ${itens.length} itens; o máximo é ${MAX_ITENS_LOTE}. Divida em lotes menores e proponha um de cada vez.`)
  }

  const propostas: PropostaOk[] = []
  const problemas: string[] = []
  itens.forEach((item, i) => {
    const proposta = proporItemDoLote(data, refs, item, responsavelPadrao)
    if (proposta.ok) propostas.push(proposta)
    else problemas.push(`Item ${i + 1} (${item.tipo ?? 'sem tipo'} "${item.nome ?? ''}"): ${proposta.mensagem}`)
  })

  // A mesma despesa paga duas vezes no lote é quase sempre item repetido na
  // fala ("luz… e a luz"), não dois pagamentos — e o segundo sobrescreveria o primeiro.
  const pagos = new Map<unknown, number>()
  propostas.forEach(p => {
    if (p.tipo !== 'pagamento') return
    pagos.set(p.payload.id, (pagos.get(p.payload.id) ?? 0) + 1)
  })
  for (const [id, vezes] of pagos) {
    if (vezes < 2) continue
    const repetida = propostas.find(p => p.tipo === 'pagamento' && p.payload.id === id)
    problemas.push(`A mesma despesa aparece ${vezes} vezes como paga: ${repetida?.resumo}. Deixe só uma.`)
  }

  if (problemas.length > 0) {
    return falha(
      `NADA FOI PREPARADO — ${problemas.length} de ${itens.length} itens do lote têm problema:\n` +
      problemas.map(p => `- ${p}`).join('\n') +
      '\nExplique ao usuário o problema de cada item, peça o que falta e depois chame propor_lote de novo com a lista ' +
      'COMPLETA (os itens que estavam certos também).'
    )
  }

  return combinarPropostas(propostas)
}

// ─── Duplicados: inclusões parecidas com algo que já existe ──────────────────
// "Lança a internet de 100" quando a internet do mês já está lá, ou o mesmo
// leite pedido duas vezes no Telegram, não pode virar uma segunda linha sem o
// usuário saber. A proposta continua sendo preparada — às vezes são mesmo duas
// coisas —, mas o retorno lista o que já existe para a IA perguntar se inclui
// mesmo assim.

/** Mesmo nome com outra grafia: um contém o outro, ou 1–2 letras de diferença (nomes curtos: só iguais). */
function nomesParecidos(a: string, b: string): boolean {
  const na = normalizar(a).replace(/\s+/g, ' ')
  const nb = normalizar(b).replace(/\s+/g, ' ')
  if (!na || !nb) return false
  if (na === nb) return true
  const menor = na.length <= nb.length ? na : nb
  if (menor.length >= 3 && (casaBusca(a, b) || casaBusca(b, a))) return true
  const tolerancia = menor.length <= 3 ? 0 : menor.length <= 5 ? 1 : 2
  return distanciaEdicao(na, nb) <= tolerancia
}

const mesmoValor = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 0.01

const semPrefixoReceita = (item: string) => item.replace(RECEITA_PREFIXO, '')

/** O que já existe no banco parecido com a inclusão `op` (vazio quando não é inclusão). */
function existentesParecidos(data: EnrichedData, op: OperacaoDoLote): string[] {
  const p = op.payload
  switch (op.tipo) {
    case 'nova_despesa':
    case 'nova_receita': {
      const receita = op.tipo === 'nova_receita'
      const mes = String(p.mes_referencia ?? '').substring(0, 7)
      const nome = semPrefixoReceita(String(p.item ?? ''))
      return data.planejamento
        .filter(x =>
          (x.item ?? '').startsWith(RECEITA_PREFIXO) === receita &&
          (x.mes_referencia ?? '').substring(0, 7) === mes &&
          nomesParecidos(semPrefixoReceita(x.item ?? ''), nome)
        )
        .map(x => `"${semPrefixoReceita(x.item)}" em ${mes} (${x.responsavel ?? 'sem responsável'}, ${R(x.valor_previsto)}` +
          `${receita ? (x.pago ? ', já recebida' : '') : (x.pago ? ', já paga' : ', em aberto')})`)
    }

    case 'item_mercado':
      return (data.mercado ?? [])
        .filter(x => !x.comprado && nomesParecidos(x.nome, String(p.nome ?? '')))
        .map(x => `"${x.nome}" na lista de mercado (quantidade ${x.quantidade}, ainda não comprado)`)

    case 'item_wishlist':
      return (data.desejos ?? [])
        .filter(x => !x.realizado && nomesParecidos(x.nome, String(p.nome ?? '')))
        .map(x => `"${x.nome}" na wishlist${x.valor_estimado ? ` (${R(x.valor_estimado)})` : ''}`)

    case 'aporte_investimento': {
      // O mesmo investimento aparece em várias linhas (uma por mês): vale
      // qualquer uma com o mesmo nome. Mesmo valor no mesmo mês = suspeito.
      const escolhido = data.investimentos.find(i => i.id === p.investimento_id)
      if (!escolhido) return []
      const ids = new Set(data.investimentos
        .filter(i => normalizar(i.descricao) === normalizar(escolhido.descricao))
        .map(i => i.id))
      const mes = String(p.data_aporte ?? '').substring(0, 7)
      return data.aportes
        .filter(x => ids.has(x.investimento_id) && (x.data_aporte ?? '').substring(0, 7) === mes && mesmoValor(Number(x.valor), p.valor))
        .map(x => `aporte de ${R(Number(x.valor))} em "${escolhido.descricao}" em ${fmtDataBR(x.data_aporte)}`)
    }

    case 'recebimento': {
      const receita = data.planejamento.find(x => x.id === p.planejamento_id)
      return (data.recebimentos ?? [])
        .filter(x => x.planejamento_id === p.planejamento_id && mesmoValor(Number(x.valor), p.valor))
        .map(x => `recebimento de ${R(Number(x.valor))} em "${semPrefixoReceita(receita?.item ?? '')}"` +
          (x.data_recebimento ? ` em ${fmtDataBR(x.data_recebimento)}` : ''))
    }

    default:
      return []
  }
}

/** Duas inclusões da mesma proposta que parecem ser a mesma coisa repetida na fala. */
function repetidasNaProposta(a: OperacaoDoLote, b: OperacaoDoLote): boolean {
  if (a.tipo !== b.tipo) return false
  const pa = a.payload, pb = b.payload
  switch (a.tipo) {
    case 'nova_despesa':
    case 'nova_receita':
      return pa.mes_referencia === pb.mes_referencia && nomesParecidos(String(pa.item ?? ''), String(pb.item ?? ''))
    case 'item_mercado':
    case 'item_wishlist':
      return nomesParecidos(String(pa.nome ?? ''), String(pb.nome ?? ''))
    case 'aporte_investimento':
      return pa.investimento_id === pb.investimento_id && mesmoValor(pa.valor, pb.valor)
    case 'recebimento':
      return pa.planejamento_id === pb.planejamento_id && mesmoValor(pa.valor, pb.valor)
    default:
      return false
  }
}

/**
 * Avisos de possíveis duplicados de uma proposta: inclusões parecidas com o que
 * já está gravado e itens repetidos dentro do próprio lote. Vazio = nada suspeito.
 */
export function avisosDeDuplicidade(data: EnrichedData, proposta: Proposta): string[] {
  if (!proposta.ok) return []
  const operacoes = operacoesDe(proposta)
  const lote = operacoes.length > 1
  const rotulo = (i: number) => lote ? `Item ${i + 1} (${operacoes[i].resumo})` : operacoes[i].resumo
  const avisos: string[] = []

  operacoes.forEach((op, i) => {
    const existentes = existentesParecidos(data, op)
    if (existentes.length > 0) {
      const lista = existentes.slice(0, 5).join('; ') + (existentes.length > 5 ? ` e mais ${existentes.length - 5}` : '')
      avisos.push(`${rotulo(i)} — já existe: ${lista}`)
    }
    const repetidas = operacoes
      .map((outra, j) => (j > i && repetidasNaProposta(op, outra) ? j + 1 : 0))
      .filter(Boolean)
    if (repetidas.length > 0) {
      avisos.push(`${rotulo(i)} — parece repetido no próprio pedido: item(ns) ${repetidas.join(', ')}`)
    }
  })
  return avisos
}

// ─── Estágio: grava a proposta como pendente, sem executar nada ──────────────

export async function estagiarProposta(ctx: ContextoEscrita, proposta: Proposta, avisosDuplicidade: string[] = []): Promise<string> {
  if (!proposta.ok) return proposta.mensagem

  // Uma proposta nova cancela qualquer pendente anterior desta conversa: só
  // pode haver uma por vez, senão um "sim" mais tarde fica ambíguo sobre qual
  // delas está confirmando.
  await ctx.supabase.from('chat_operacoes')
    .update({ status: 'cancelada', resolved_at: new Date().toISOString() })
    .eq('conversation_id', ctx.conversationId)
    .eq('status', 'pendente')

  const { error } = await ctx.supabase.from('chat_operacoes').insert({
    conversation_id: ctx.conversationId,
    tipo: proposta.tipo,
    payload: proposta.payload,
    resumo: proposta.resumo,
    usuario: ctx.usuario,
  })
  if (error) {
    console.error('[writeEngine] estagiarProposta:', error.message)
    return 'Não consegui preparar essa operação agora (falha interna ao salvar a proposta). Tente de novo.'
  }

  const orientacaoLote = proposta.tipo === 'lote'
    ? 'Mostre a lista COMPLETA (todos os itens, na ordem) e os totais — não resuma nem omita itens. '
    : ''
  const orientacaoDuplicidade = avisosDuplicidade.length > 0
    ? `ATENÇÃO — POSSÍVEL DUPLICIDADE:\n${avisosDuplicidade.map(a => `- ${a}`).join('\n')}\n` +
      'Avise o usuário disso com destaque, mostrando o que já existe, e pergunte se quer incluir MESMO ASSIM ' +
      '(ou se prefere tirar o item repetido / cancelar). '
    : ''
  return (
    `PROPOSTA PENDENTE DE CONFIRMAÇÃO: ${proposta.resumo}\n` +
    orientacaoLote +
    orientacaoDuplicidade +
    'Mostre esse resumo ao usuário nesta resposta e pergunte se confirma. NÃO chame confirmar_operacao ' +
    'ou cancelar_operacao agora — isso só acontece numa mensagem FUTURA do usuário, depois que ele responder.'
  )
}

// ─── Confirmar / cancelar: agem só sobre a pendente mais recente ─────────────

interface OperacaoPendente {
  id: string
  tipo: string
  payload: Record<string, unknown>
  resumo: string
}

async function buscarPendente(ctx: ContextoEscrita): Promise<OperacaoPendente | null> {
  const { data } = await ctx.supabase
    .from('chat_operacoes')
    .select('id, tipo, payload, resumo')
    .eq('conversation_id', ctx.conversationId)
    .eq('status', 'pendente')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as OperacaoPendente | null) ?? null
}

async function registrarLog(ctx: ContextoEscrita, op: OperacaoDoLote): Promise<void> {
  const ACAO_POR_TIPO: Record<string, string> = {
    pagamento: 'pagar',
    nova_despesa: 'inserir',
    nova_receita: 'inserir',
    recebimento: 'receber',
    aporte_investimento: 'aporte',
    item_mercado: 'inserir',
    item_wishlist: 'inserir',
  }
  const TABELA_POR_TIPO: Record<string, string> = {
    pagamento: 'planejamento',
    nova_despesa: 'planejamento',
    nova_receita: 'planejamento',
    recebimento: 'receitas_recebimentos',
    aporte_investimento: 'investimentos_aportes',
    item_mercado: 'lista_mercado_itens',
    item_wishlist: 'wishlist_items',
  }
  const valor = typeof op.payload.valor_real === 'number' ? op.payload.valor_real
    : typeof op.payload.valor_previsto === 'number' ? op.payload.valor_previsto
    : typeof op.payload.valor === 'number' ? op.payload.valor
    : undefined

  const { error } = await ctx.supabase.from('activity_logs').insert({
    acao: ACAO_POR_TIPO[op.tipo] ?? 'inserir',
    tabela: TABELA_POR_TIPO[op.tipo] ?? op.tipo,
    descricao: `IA: ${op.resumo}`,
    valor: valor ?? null,
    usuario: ctx.usuario,
  })
  if (error) console.error('[writeEngine] registrarLog:', error.message)
}

/** Executa de fato o payload já estagiado — a mesma escrita que a tela faria. */
async function executarPayload(ctx: ContextoEscrita, op: OperacaoDoLote): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const p = op.payload
  const erro = (msg: string) => ({ ok: false as const, mensagem: msg })

  switch (op.tipo) {
    case 'pagamento': {
      const { error } = await ctx.supabase.from('planejamento')
        .update({ pago: true, valor_real: p.valor_real, data_pagamento: p.data_pagamento })
        .eq('id', p.id)
      return error ? erro(error.message) : { ok: true }
    }

    case 'nova_despesa':
    case 'nova_receita': {
      const { error } = await ctx.supabase.from('planejamento').insert({
        mes_referencia: p.mes_referencia,
        item: p.item,
        responsavel: p.responsavel,
        categoria: p.categoria,
        valor_previsto: p.valor_previsto,
        pago: false,
        valor_real: null,
        data_vencimento: p.data_vencimento ?? null,
        data_pagamento: null,
      })
      return error ? erro(error.message) : { ok: true }
    }

    case 'recebimento': {
      const { error } = await ctx.supabase.from('receitas_recebimentos').insert({
        planejamento_id: p.planejamento_id,
        valor: p.valor,
        data_recebimento: p.data_recebimento,
      })
      if (error) return erro(error.message)

      // Mesma regra da tela de Receitas: se o total recebido alcançou o
      // previsto, marca a receita como paga.
      const [{ data: linha }, { data: recebimentos }] = await Promise.all([
        ctx.supabase.from('planejamento').select('valor_previsto').eq('id', p.planejamento_id).maybeSingle(),
        ctx.supabase.from('receitas_recebimentos').select('valor').eq('planejamento_id', p.planejamento_id),
      ])
      const total = (recebimentos ?? []).reduce((acc, r) => acc + Number(r.valor ?? 0), 0)
      if (linha && total >= Number(linha.valor_previsto ?? 0)) {
        await ctx.supabase.from('planejamento').update({ pago: true, valor_real: total }).eq('id', p.planejamento_id)
      }
      return { ok: true }
    }

    case 'aporte_investimento': {
      const { error } = await ctx.supabase.from('investimentos_aportes').insert({
        investimento_id: p.investimento_id,
        valor: p.valor,
        data_aporte: p.data_aporte,
        saldo_atual: p.saldo_atual ?? null,
        observacao: p.observacao ?? null,
      })
      return error ? erro(error.message) : { ok: true }
    }

    case 'item_mercado': {
      const { error } = await ctx.supabase.from('lista_mercado_itens').insert({
        nome: p.nome,
        quantidade: p.quantidade,
        preco_unit: null,
        comprado: false,
        criado_por: ctx.usuario,
      })
      return error ? erro(error.message) : { ok: true }
    }

    case 'item_wishlist': {
      const { error } = await ctx.supabase.from('wishlist_items').insert({
        nome: p.nome,
        valor_estimado: p.valor_estimado ?? null,
        categoria: p.categoria ?? null,
        prioridade: p.prioridade,
        favoritado: false,
        realizado: false,
        criado_por: ctx.usuario,
      })
      return error ? erro(error.message) : { ok: true }
    }

    default:
      return erro(`Tipo de operação desconhecido: ${op.tipo}`)
  }
}

export async function confirmarOperacao(ctx: ContextoEscrita, jaProposNesteTurno: boolean): Promise<string> {
  if (jaProposNesteTurno) {
    return (
      'BLOQUEADO: essa operação foi proposta NESTA MESMA resposta — confirmar agora não conta como aprovação do ' +
      'usuário. Escreva o resumo da proposta e pare por aqui; só chame confirmar_operacao numa mensagem futura, ' +
      'depois que o usuário responder confirmando.'
    )
  }

  const pendente = await buscarPendente(ctx)
  if (!pendente) {
    return (
      'NENHUMA OPERAÇÃO PENDENTE (instrução interna — não repita este texto). Nada foi preparado antes, então não há ' +
      'o que confirmar. Se a pessoa está confirmando algo que você descreveu numa resposta anterior, prepare agora com ' +
      'o propor_* certo (vários itens = propor_lote) e mostre o resumo pedindo confirmação. Se não está claro o que ' +
      'ela quer confirmar, pergunte.'
    )
  }
  if (pendente.tipo === 'lote') return confirmarLote(ctx, pendente)

  const resultado = await executarPayload(ctx, pendente)
  if (!resultado.ok) {
    return `Falha ao gravar "${pendente.resumo}": ${resultado.mensagem}. A operação continua pendente — o usuário pode tentar confirmar de novo ou cancelar.`
  }

  await ctx.supabase.from('chat_operacoes')
    .update({ status: 'confirmada', resolved_at: new Date().toISOString() })
    .eq('id', pendente.id)
  await registrarLog(ctx, pendente)

  return `CONFIRMADO E GRAVADO: ${pendente.resumo}. Avise o usuário que foi feito.`
}

/**
 * Grava as operações do lote uma a uma, na ordem (um recebimento depois do
 * outro precisa ver o anterior para decidir se a receita fechou). Não há
 * transação entre tabelas pelo client do Supabase, então uma falha no meio
 * não desfaz o que já entrou: o que gravou fica registrado como confirmado, e
 * só o que falhou continua pendente — um novo "sim" tenta só esses de novo,
 * sem duplicar os que já foram.
 */
async function confirmarLote(ctx: ContextoEscrita, pendente: OperacaoPendente): Promise<string> {
  const operacoes = (pendente.payload.operacoes as OperacaoDoLote[] | undefined) ?? []
  const gravadas: OperacaoDoLote[] = []
  const falhas: { op: OperacaoDoLote; mensagem: string }[] = []

  for (const op of operacoes) {
    const resultado = await executarPayload(ctx, op)
    if (resultado.ok) {
      gravadas.push(op)
      await registrarLog(ctx, op)
    } else {
      falhas.push({ op, mensagem: resultado.mensagem })
    }
  }

  const agora = new Date().toISOString()
  const listaFalhas = falhas.map(f => `- ${f.op.resumo}: ${f.mensagem}`).join('\n')

  if (gravadas.length === 0) {
    return `Falha ao gravar o lote — nenhuma das ${operacoes.length} operações entrou:\n${listaFalhas}\n` +
      'O lote continua pendente — o usuário pode tentar confirmar de novo ou cancelar.'
  }

  if (falhas.length === 0) {
    await ctx.supabase.from('chat_operacoes')
      .update({ status: 'confirmada', resolved_at: agora })
      .eq('id', pendente.id)
    return `CONFIRMADO E GRAVADO: ${pendente.resumo}\nAs ${operacoes.length} operações foram gravadas. Avise o usuário que foi feito.`
  }

  // Parcial: a linha original passa a descrever só o que gravou, e o que
  // falhou vira uma nova pendente — a única desta conversa.
  const confirmado = combinarPropostas(gravadas.map(op => ({ ok: true as const, ...op })))
  await ctx.supabase.from('chat_operacoes')
    .update({ status: 'confirmada', resolved_at: agora, tipo: confirmado.tipo, payload: confirmado.payload, resumo: confirmado.resumo })
    .eq('id', pendente.id)
  const restante = combinarPropostas(falhas.map(f => ({ ok: true as const, ...f.op })))
  const { error } = await ctx.supabase.from('chat_operacoes').insert({
    conversation_id: ctx.conversationId,
    tipo: restante.tipo,
    payload: restante.payload,
    resumo: restante.resumo,
    usuario: ctx.usuario,
  })
  if (error) console.error('[writeEngine] confirmarLote (restante):', error.message)

  return (
    `CONFIRMADO E GRAVADO PARCIALMENTE: ${gravadas.length} de ${operacoes.length} operações entraram.\n` +
    `Gravadas:\n${gravadas.map(op => `- ${op.resumo}`).join('\n')}\n` +
    `NÃO gravadas:\n${listaFalhas}\n` +
    (error
      ? 'As que falharam não puderam ser guardadas para nova tentativa: o usuário precisa pedir de novo.'
      : 'As que falharam continuam pendentes: diga isso ao usuário e pergunte se quer tentar de novo ou cancelar.')
  )
}

export async function cancelarOperacao(ctx: ContextoEscrita): Promise<string> {
  const pendente = await buscarPendente(ctx)
  if (!pendente) return 'NENHUMA OPERAÇÃO PENDENTE (instrução interna): não havia nada para cancelar. Diga à pessoa que nada foi lançado.'

  await ctx.supabase.from('chat_operacoes')
    .update({ status: 'cancelada', resolved_at: new Date().toISOString() })
    .eq('id', pendente.id)

  return `Operação cancelada: ${pendente.resumo}.`
}
