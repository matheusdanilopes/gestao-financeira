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
 */

import { format } from 'date-fns'
import type { criarSupabaseServer } from '../../supabaseServer'
import type { EnrichedData } from '../types'
import { casaBusca, normalizar, normalizarMes, type Referencias } from './queryEngine'
import { formatBRL } from '../../format'

type Supabase = ReturnType<typeof criarSupabaseServer>

const R = formatBRL
const RECEITA_PREFIXO = '[RECEITA] '
const fmtDataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

function dataValida(valor: unknown, padrao: Date): string {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10)
  return format(padrao, 'yyyy-MM-dd')
}

export interface ContextoEscrita {
  supabase: Supabase
  conversationId: string
  /** E-mail do usuário logado, só para auditoria (activity_logs / criado_por). */
  usuario: string | null
}

type Proposta =
  | { ok: true; tipo: string; payload: Record<string, unknown>; resumo: string }
  | { ok: false; mensagem: string }

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
}): Proposta {
  const descricao = a.descricao?.trim()
  if (!descricao) return falha('Informe a descrição da despesa.')
  if (!a.valor || a.valor <= 0) return falha('Informe um valor maior que zero.')

  const mes = normalizarMes(a.mes) ?? refs.mesApp
  const responsavel = a.responsavel?.trim() || 'Matheus'
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
}): Proposta {
  const descricao = a.descricao?.trim()
  if (!descricao) return falha('Informe a descrição da receita.')
  if (!a.valor || a.valor <= 0) return falha('Informe um valor maior que zero.')

  const mes = normalizarMes(a.mes) ?? refs.mesApp
  const responsavel = a.responsavel?.trim() || 'Matheus'

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

// ─── Estágio: grava a proposta como pendente, sem executar nada ──────────────

export async function estagiarProposta(ctx: ContextoEscrita, proposta: Proposta): Promise<string> {
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

  return (
    `PROPOSTA PENDENTE DE CONFIRMAÇÃO: ${proposta.resumo}\n` +
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

async function registrarLog(ctx: ContextoEscrita, op: OperacaoPendente): Promise<void> {
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
async function executarPayload(ctx: ContextoEscrita, op: OperacaoPendente): Promise<{ ok: true } | { ok: false; mensagem: string }> {
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
    return 'Não há nenhuma operação pendente para confirmar nesta conversa. Se o usuário quer lançar algo, use a ferramenta propor_* correspondente primeiro.'
  }

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

export async function cancelarOperacao(ctx: ContextoEscrita): Promise<string> {
  const pendente = await buscarPendente(ctx)
  if (!pendente) return 'Não havia nenhuma operação pendente nesta conversa.'

  await ctx.supabase.from('chat_operacoes')
    .update({ status: 'cancelada', resolved_at: new Date().toISOString() })
    .eq('id', pendente.id)

  return `Operação cancelada: ${pendente.resumo}.`
}
