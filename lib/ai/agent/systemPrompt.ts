/**
 * Prompt do agente financeiro.
 *
 * Estratégia oposta à da versão anterior: em vez de despejar todo o contexto
 * possível (montado por regex de intenção) e torcer para a fatia certa estar
 * lá, o prompt carrega apenas um SNAPSHOT curto — o suficiente para responder
 * perguntas triviais sem nenhuma consulta — e ensina o modelo a buscar o resto
 * com as ferramentas. Prompt curto = mais atenção nos números que importam e
 * menos chance de o modelo "não achar" um dado que recebeu.
 */

import { format, addMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatBRL } from '../../format'
import type { EnrichedData, FinancialInsightsContext, TelaAtual, ValidationCertificate } from '../types'
import { fmtMes, type Referencias } from './queryEngine'

// Formato completo (com centavos): o modelo copia estes valores direto para a
// resposta, então uma string como "R$ 209,4" chegaria torta ao usuário.
const R = formatBRL
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

const TELAS: Partial<Record<TelaAtual, string>> = {
  dashboard: 'o painel geral',
  compras: 'a tela de compras no cartão',
  financas: 'a tela de finanças (planejamento vs realizado)',
  investimentos: 'a tela de investimentos',
  assinaturas: 'a tela de assinaturas',
  receitas: 'a tela de receitas',
  analytics: 'a tela de análises',
  wishlist: 'a lista de desejos',
  'lista-mercado': 'a lista de mercado',
}

// ─── Identidade e regras ─────────────────────────────────────────────────────

const IDENTIDADE = `Você é o analista financeiro pessoal de Matheus e Jeniffer, um casal que administra as finanças em conjunto neste app. Responda em português brasileiro, direto ao ponto, como um consultor que já conhece a situação deles.`

const MODELO_DE_DADOS = `COMO OS DADOS SÃO ORGANIZADOS
- COMPRA: lançamento individual no cartão de crédito. É a maior fonte de gasto. Toda compra pertence a uma FATURA mensal — e a fatura NÃO é o mês da compra: uma compra feita depois do fechamento cai na fatura do mês seguinte. Todo filtro por mês nas compras usa o mês da FATURA.
- PARCELA: fração mensal de uma compra parcelada (ex.: 3/10). Não confunda com assinatura.
- DESPESA PLANEJADA (ou conta fixa): item do orçamento mensal — aluguel, energia, internet, boleto. Não passa necessariamente pelo cartão. Tem vencimento e pode estar paga ou em aberto.
- RECEITA: entrada de dinheiro (salário, freelance, reembolso), com mês de referência e status de recebimento.
- ASSINATURA: serviço recorrente mensal cobrado no cartão (Netflix, Spotify…). Já está embutida nas compras da fatura — nunca some assinaturas ao total da fatura, isso conta duas vezes.
- INVESTIMENTO / APORTE: carteira e depósitos feitos nela.
- ESTORNO: compra cancelada. Já foi removida do total da fatura.
Nunca some receitas junto com despesas ao calcular "total gasto".`

const USO_DE_FERRAMENTAS = `COMO BUSCAR DADOS
O snapshot abaixo é só o estado geral do momento. Para QUALQUER pergunta que peça um recorte específico — um estabelecimento, uma categoria, um mês diferente, uma comparação, uma pessoa, um histórico — use as ferramentas. Elas leem os dados reais do casal.

Regras inegociáveis:
1. NUNCA diga que não tem acesso a um dado, que "não consegue consultar" ou que "precisa de mais informação" antes de tentar pelo menos uma ferramenta. Você TEM acesso.
2. Se uma consulta voltar vazia, não conclua na hora que o dado não existe: tente outra abordagem (período maior, sem o filtro de categoria, busca por texto na descrição) ou chame listar_dimensoes para ver o que existe de fato. Só depois disso afirme que não há registro.
3. Encadeie quantas consultas forem necessárias (uma por vez) até ter os números para responder com precisão. Prefira uma consulta a mais do que um chute.
4. Nunca invente valores, datas ou nomes. Todo número citado precisa ter vindo do snapshot ou de uma consulta desta conversa.
5. Se o usuário for ambíguo quanto ao período, assuma o mês corrente e diga qual período você usou.`

const FORMATO = `COMO RESPONDER
- Valores sempre como R$ 1.234,56.
- Sempre cite números concretos; nada de "aumentou um pouco".
- Ao comparar, diga a diferença em R$ e em %.
- Markdown enxuto: **negrito** nos números que importam, listas curtas quando houver vários itens. Sem títulos grandes nem tabelas largas — a tela é um celular.
- 2 a 4 frases ou uma lista curta resolve a maioria das perguntas. Só se estenda quando a pergunta realmente exigir.
- Termine com uma observação acionável quando ela agregar (o que cortar, o que vence, o que revisar). Sem encher linguiça.
- Quando o número vier de um mês ainda em formação (a fatura corrente), avise que é parcial.`

// ─── Snapshot ────────────────────────────────────────────────────────────────

export function buildSnapshot(
  data: EnrichedData,
  m: FinancialInsightsContext,
  refs: Referencias
): string {
  const linhas: string[] = ['SNAPSHOT DO MOMENTO (números já apurados — use direto, sem consultar)']

  // Dois cuidados aqui, ambos fáceis de errar e de virar número trocado na
  // resposta ao usuário:
  //  1. Os rótulos vêm de `refs`, não de m.mesAtual/m.mesAnterior — aqueles já
  //     chegam formatados ("SET/2026") e nomeiam o mês-calendário, enquanto os
  //     totais de fatura são apurados sobre o período de COBRANÇA.
  //  2. m.totalGastos é só cartão, mas m.totalGastosAnterior (e variacaoGastos)
  //     já somam cartão + contas fixas. Comparar um com o outro seria
  //     comparar coisas diferentes, então cada par é apresentado separado.
  const variacaoCartao = m.totalCartaoAnterior > 0
    ? ((m.totalGastos - m.totalCartaoAnterior) / m.totalCartaoAnterior) * 100
    : undefined

  linhas.push(
    `Fatura de cartão em formação (${fmtMes(refs.mesFatura)}): ${R(m.totalGastos)}` +
    (m.totalCartaoAnterior > 0
      ? ` · última fatura fechada (${fmtMes(refs.mesCalendario)}): ${R(m.totalCartaoAnterior)}${variacaoCartao !== undefined ? ` (${pct(variacaoCartao)})` : ''}`
      : '') +
    (m.mediaCartaoHistorica > 0 ? ` · média histórica de fatura: ${R(m.mediaCartaoHistorica)}` : '')
  )

  if (m.totalOrcado > 0 || m.totalGastosAnterior > 0) {
    linhas.push(
      `Total do mês (fatura + contas fixas): ${R(m.totalGastos + m.totalOrcado)}` +
      (m.totalGastosAnterior > 0 ? ` · período anterior: ${R(m.totalGastosAnterior)} (${pct(m.variacaoGastos)})` : '') +
      (m.mediaMensalHistorica > 0 ? ` · média mensal 6m: ${R(m.mediaMensalHistorica)}` : '')
    )
  }

  // gastoPorCartao já vem chaveado pelo nome exibido do cartão (computeInsights).
  const porCartao = Object.entries(m.gastoPorCartao ?? {})
  if (porCartao.length > 0) {
    linhas.push(`Fatura por cartão: ${porCartao.map(([c, v]) => `${c} ${R(v)}`).join(' · ')}`)
  }
  linhas.push(`Fatura por responsável: Matheus ${R(m.gastoMatheus)} · Jeniffer ${R(m.gastoJeniffer)}`)

  if (m.topCategorias.length > 0) {
    linhas.push(`Maiores categorias da fatura: ${m.topCategorias.slice(0, 4).map(c => `${c.categoria} ${R(c.valor)} (${c.percentual.toFixed(0)}%${c.variacao !== undefined ? `, ${pct(c.variacao)} vs mês ant.` : ''})`).join(' · ')}`)
  }

  if (m.totalOrcado > 0) {
    linhas.push(
      `Contas fixas de ${fmtMes(refs.mesCalendario)}: orçado ${R(m.totalOrcado)} · pago ${R(m.totalPago)} · em aberto ${R(m.despesasEmAberto)}` +
      (m.itensVencidos.length > 0 ? ` · ⚠️ ${m.itensVencidos.length} vencida(s) somando ${R(m.itensVencidos.reduce((s, i) => s + i.valor, 0))}` : '')
    )
  }
  if (m.itensVencendo7d.length > 0) {
    linhas.push(`Vencendo nos próximos 7 dias: ${m.itensVencendo7d.slice(0, 5).map(i => `${i.item} ${R(i.valor)} (${i.vencimento})`).join(' · ')}`)
  }

  if (m.rendaMensal) {
    linhas.push(
      `Renda de referência: ${R(m.rendaMensal)}/mês` +
      (m.sobraLiquida !== undefined ? ` · sobra estimada ${R(m.sobraLiquida)}` : '') +
      (m.taxaPoupanca !== undefined ? ` · taxa de poupança ${m.taxaPoupanca.toFixed(1)}%` : '')
    )
  }

  if (m.assinaturasAtivas > 0) {
    linhas.push(`Assinaturas ativas: ${m.assinaturasAtivas} somando ${R(m.totalAssinaturas)}/mês (já dentro da fatura).`)
  }
  if (m.comprasParceladas.count > 0) {
    linhas.push(`Parcelamentos na fatura atual: ${m.comprasParceladas.count} compra(s), ${R(m.comprasParceladas.totalValor)} no mês.`)
  }
  if (m.totalAportesHistorico > 0) {
    linhas.push(`Investimentos: ${R(m.totalAportesHistorico)} aportados no histórico registrado.`)
  }
  if (m.mediaMensalHistorica > 0) {
    linhas.push(`Tendência dos últimos 3 meses: ${m.tendencia} (${pct(m.tendenciaPct)}).`)
  }

  // Cobertura: sem isso o modelo não sabe até onde pode pedir histórico e
  // tende a supor que "não tem" um mês que na verdade está disponível.
  const mesesTx = data.transacoes.map(t => (t.projeto_fatura ?? '').substring(0, 7)).filter(Boolean).sort()
  if (mesesTx.length > 0) {
    linhas.push(`Cobertura das compras: faturas de ${fmtMes(mesesTx[0])} até ${fmtMes(mesesTx[mesesTx.length - 1])} (${data.transacoes.length} lançamentos consultáveis).`)
  }

  return linhas.join('\n')
}

// ─── Montagem final ──────────────────────────────────────────────────────────

export function buildSystemPrompt({
  data,
  metrics,
  refs,
  certificate,
  tela,
  resumoConversa,
}: {
  data: EnrichedData
  metrics: FinancialInsightsContext
  refs: Referencias
  certificate: ValidationCertificate
  tela?: TelaAtual
  resumoConversa?: string
}): string {
  const dataHoje = format(refs.hoje, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
  const telaTexto = tela && TELAS[tela] ? ` O usuário está olhando ${TELAS[tela]} agora.` : ''

  const temporal = [
    'REFERÊNCIAS DE TEMPO',
    `Hoje é ${dataHoje} (dia ${refs.diaAtual}).`,
    `Mês corrente (contas fixas e receitas): ${refs.mesCalendario}.`,
    `Fatura em formação (compras de cartão): ${refs.mesFatura} — fecha no mês que vem, então ainda vai crescer.`,
    `Fatura fechada mais recente: ${format(addMonths(refs.hoje, 0), 'yyyy-MM')}.`,
    'Sempre passe meses às ferramentas no formato YYYY-MM.',
  ].join('\n')

  const qualidade = certificate.problemas.length > 0
    ? `QUALIDADE DOS DADOS: confiabilidade ${certificate.indiceConfiabilidade}%. ${certificate.resumo} ` +
      `Mencione uma ressalva ao usuário apenas se ela afetar diretamente a resposta.`
    : `QUALIDADE DOS DADOS: confiabilidade ${certificate.indiceConfiabilidade}%, sem inconsistências relevantes.`

  const resumo = resumoConversa
    ? `RESUMO DO QUE JÁ FOI CONVERSADO\n${resumoConversa.replace('[RESUMO] ', '')}`
    : ''

  return [
    IDENTIDADE + telaTexto,
    temporal,
    MODELO_DE_DADOS,
    USO_DE_FERRAMENTAS,
    buildSnapshot(data, metrics, refs),
    qualidade,
    resumo,
    FORMATO,
  ].filter(Boolean).join('\n\n')
}

/**
 * Prompt usado quando o motor de validação bloqueia o dataset: o modelo não
 * recebe ferramenta nenhuma e só explica a situação.
 */
export function buildBlockedPrompt(certificate: ValidationCertificate): string {
  const problemas = certificate.problemas
    .filter(p => p.severity === 'critical')
    .slice(0, 5)
    .map(p => `- ${p.descricao}`)
    .join('\n')

  return [
    IDENTIDADE,
    'ATENÇÃO: a auditoria automática encontrou inconsistências CRÍTICAS nos dados financeiros e a análise está bloqueada.',
    `Confiabilidade apurada: ${certificate.indiceConfiabilidade}%.`,
    problemas ? `Problemas detectados:\n${problemas}` : '',
    'Explique isso ao usuário em 2 ou 3 frases, diga o que precisa ser revisado (provavelmente uma importação duplicada) e sugira conferir a tela de importação. NÃO produza análises, totais ou recomendações com estes dados.',
  ].filter(Boolean).join('\n\n')
}
