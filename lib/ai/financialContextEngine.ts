/**
 * Financial Context Engine
 *
 * Camada intermediária entre o banco de dados e a IA.
 * Garante que a IA receba apenas o contexto relevante para cada pergunta,
 * sem acesso direto a todas as transações.
 *
 * Estratégia:
 *  - Primeira mensagem: contexto completo (~800–1200 tokens)
 *  - Mensagens seguintes: contexto focado no domínio da pergunta (~100–300 tokens)
 *  - Sempre inclui snapshot compacto (estado financeiro atual)
 *  - Dados detalhados apenas sob demanda (RAG financeiro)
 */

import { format, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { fetchEnrichedData } from './contextBuilder'
import { computeInsights, getMesEfetivo as mesEfetivo, nomeCartao } from './insightsEngine'
import type { EnrichedData, FinancialInsightsContext, Transacao, TelaAtual } from './types'

// ─── Formatters ───────────────────────────────────────────────────────────────

const R = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

const fmtMes = (yyyyMM: string) => {
  try { return format(new Date(yyyyMM + '-02'), 'MMM/yy', { locale: ptBR }).toUpperCase() }
  catch { return yyyyMM }
}

function sumTx(txs: Transacao[]) {
  return txs.reduce((s, t) => s + t.valor, 0)
}

// ─── Domain Detection ─────────────────────────────────────────────────────────

export type ContextDomain =
  | 'cartao'        // fatura, cartão, parcelamento, compras
  | 'investimentos' // aporte, carteira, rendimento, patrimônio
  | 'orcamento'     // orçamento, previsto, pago, budget
  | 'planejamento'  // consigo, posso, viajar, meta, reserva, economizar
  | 'categoria'     // quanto gastei com X, gasto em Alimentação
  | 'historico'     // comparar, histórico, mês passado, tendência
  | 'insights'      // problema, análise, principal, alerta
  | 'geral'         // fallback

export function detectContextDomain(pergunta: string): ContextDomain {
  const p = pergunta.toLowerCase()
  if (/fatura|parcel|cartão|cartao|compra cara|gastei demais/.test(p)) return 'cartao'
  if (/invest|aporte|carteira|patrimôni|patrimoni|rendimento/.test(p)) return 'investimentos'
  if (/orçamento|orcamento|previsto|budget|está pago|foi pago|paguei/.test(p)) return 'orcamento'
  if (/consigo|posso|viajar|economizar|reserva|emergência|emergencia|sobra|meta financ/.test(p)) return 'planejamento'
  if (/quanto gastei|gast.*com|quanto.*ifood|quanto.*uber|quanto.*netflix|quanto.*spotify|quanto.*mercado|quanto.*alimenta|quanto.*lazer/.test(p)) return 'categoria'
  if (/compar|histórico|historico|mês passado|mes passado|evolu|tendência|tendencia|antes/.test(p)) return 'historico'
  if (/problema|pior|análise|analise|principal|insight|piora|alerta/.test(p)) return 'insights'
  return 'geral'
}

function detectCategorias(pergunta: string): string[] {
  const p = pergunta.toLowerCase()
  const MAP: Record<string, string[]> = {
    'Alimentação': ['alimenta', 'comida', 'restaurante', 'ifood', 'delivery', 'lanche'],
    'Mercado': ['mercado', 'supermercado'],
    'Saúde': ['saúde', 'saude', 'médico', 'farmácia', 'farmacia', 'pilates', 'academia'],
    'Transporte': ['transporte', 'gasolina', 'uber', 'combustível', 'combustivel'],
    'Entretenimento': ['entretenimento', 'netflix', 'streaming', 'spotify', 'disney', 'lazer', 'cinema'],
    'Educação': ['educação', 'educacao', 'escola', 'curso', 'faculdade'],
    'Moradia': ['aluguel', 'condomínio', 'condominio', 'energia', 'internet', 'água', 'agua'],
  }
  return Object.entries(MAP)
    .filter(([, kws]) => kws.some(kw => p.includes(kw)))
    .map(([cat]) => cat)
}

// ─── Camada 1: Perfil Financeiro ──────────────────────────────────────────────

function buildPerfilLayer(data: EnrichedData): string {
  if (data.configuracoes.length === 0) return ''
  const cfg = Object.fromEntries(data.configuracoes.map(c => [c.chave, c.valor]))
  const parts: string[] = []
  if (cfg.renda_mensal) parts.push(`Renda: ${R(parseFloat(cfg.renda_mensal))}/mês`)
  if (cfg.perfil_investidor) parts.push(`Perfil: ${cfg.perfil_investidor}`)
  if (cfg.objetivo_financeiro) parts.push(`Objetivo: ${cfg.objetivo_financeiro}`)
  return parts.length > 0 ? `PERFIL: ${parts.join(' | ')}` : ''
}

// ─── Camada 2: Snapshot Financeiro ───────────────────────────────────────────

function buildSnapshotLayer(m: FinancialInsightsContext): string {
  const vsAnt = m.totalGastosAnterior > 0 ? ` | vs ${m.mesAnterior}: ${pct(m.variacaoGastos)}` : ''
  const vsHist = m.mediaMensalHistorica > 0
    ? ` | vs média 6m: ${pct(((m.totalGastos - m.mediaMensalHistorica) / m.mediaMensalHistorica) * 100)}`
    : ''
  const lines = [
    `SNAPSHOT ${m.mesAtual} (Dia ${m.diaAtual}):`,
    `Gastos: ${R(m.totalGastos)}${vsAnt}${vsHist}`,
    `Matheus: ${R(m.gastoMatheus)} | Jeniffer: ${R(m.gastoJeniffer)}`,
  ]
  if (m.totalAportesHistorico > 0) lines.push(`Investimentos total histórico: ${R(m.totalAportesHistorico)}`)
  return lines.join('\n')
}

// ─── Camada 3: Indicadores Financeiros ───────────────────────────────────────

function buildIndicadoresLayer(m: FinancialInsightsContext): string {
  const lines: string[] = []

  const top = m.topCategorias[0]
  if (top) {
    const varStr = top.variacao !== undefined ? ` | ${pct(top.variacao)} vs mês ant` : ''
    lines.push(`Categoria líder: ${top.categoria} ${R(top.valor)} (${top.percentual.toFixed(0)}%)${varStr}`)
  }

  if (m.totalOrcado > 0) {
    const pctPago = Math.round((m.totalPago / m.totalOrcado) * 100)
    const vencStr = m.itensVencidos.length > 0 ? ` | ⚠️ ${m.itensVencidos.length} vencido(s)` : ''
    lines.push(`Orçamento: ${pctPago}% executado | Em aberto: ${R(m.despesasEmAberto)}${vencStr}`)
  }

  if (m.itensVencendo7d.length > 0) {
    const total = m.itensVencendo7d.reduce((s, i) => s + i.valor, 0)
    lines.push(`Vencendo em 7 dias: ${m.itensVencendo7d.length} item(s) — ${R(total)}`)
  }

  if (m.mediaMensalHistorica > 0) {
    lines.push(`Tendência 3m: ${m.tendencia} (${pct(m.tendenciaPct)}) | Média 6m: ${R(m.mediaMensalHistorica)}/mês`)
  }

  return lines.length > 0 ? `INDICADORES:\n${lines.join('\n')}` : ''
}

// ─── Camada 4: Tendências por Categoria ──────────────────────────────────────

function buildTendenciasLayer(data: EnrichedData, hoje: Date): string {
  const meses3 = Array.from({ length: 3 }, (_, i) => format(subMonths(hoje, i + 1), 'yyyy-MM'))
  const meses3ant = Array.from({ length: 3 }, (_, i) => format(subMonths(hoje, i + 4), 'yyyy-MM'))

  const catsAtual: Record<string, number> = {}
  const catsAnt: Record<string, number> = {}
  for (const t of data.transacoes) {
    const m = mesEfetivo(t)
    const cat = t.categoria ?? 'Sem categoria'
    if (meses3.includes(m)) catsAtual[cat] = (catsAtual[cat] ?? 0) + t.valor
    if (meses3ant.includes(m)) catsAnt[cat] = (catsAnt[cat] ?? 0) + t.valor
  }

  const topCats = Object.entries(catsAtual).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const trends = topCats.map(([cat, valor3m]) => {
    const ant = catsAnt[cat] ?? 0
    const varPct = ant > 0 ? ((valor3m - ant) / ant) * 100 : 0
    const label =
      Math.abs(varPct) < 5 ? 'estável' :
      varPct > 15 ? 'crescimento_contínuo' :
      varPct > 0 ? 'alta' : 'queda'
    return `${cat}: ${label} (${pct(varPct)})`
  })

  return trends.length > 0 ? `TENDÊNCIAS (últimos 3m):\n${trends.join(' · ')}` : ''
}

// ─── Motor de Contexto de Cartões ────────────────────────────────────────────

function buildCardMotor(data: EnrichedData, hoje: Date): string {
  const mesAtual = format(hoje, 'yyyy-MM')
  const txAtual = data.transacoes.filter(t => mesEfetivo(t) === mesAtual)
  if (txAtual.length === 0) return ''

  const porCartao: Record<string, Transacao[]> = {}
  for (const t of txAtual) {
    const c = nomeCartao(t.cartao)
    if (!porCartao[c]) porCartao[c] = []
    porCartao[c].push(t)
  }

  const sections: string[] = ['CARTÃO — FATURA ATUAL:']

  for (const [cartao, txs] of Object.entries(porCartao)) {
    const total = sumTx(txs)

    const totais6m = Array.from({ length: 6 }, (_, i) => {
      const m = format(subMonths(hoje, i + 1), 'yyyy-MM')
      return sumTx(data.transacoes.filter(t => mesEfetivo(t) === m && (nomeCartao(t.cartao)) === cartao))
    })
    const validos = totais6m.filter(v => v > 0)
    const media6m = validos.length > 0 ? totais6m.reduce((s, v) => s + v, 0) / validos.length : 0
    const varPct = media6m > 0 ? ((total - media6m) / media6m) * 100 : 0

    const catTotals: Record<string, number> = {}
    for (const t of txs) {
      const cat = t.categoria ?? 'Sem categoria'
      catTotals[cat] = (catTotals[cat] ?? 0) + t.valor
    }
    const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 3)

    const parcelamentos = txs.filter(t => t.total_parcelas && t.total_parcelas > 1).length
    const mediaCompra = total / Math.max(txs.length, 1)
    const incomuns = txs.filter(t => t.valor > mediaCompra * 3)

    sections.push(`${cartao}: ${R(total)} | média 6m: ${R(media6m)} | ${pct(varPct)}`)
    sections.push(`  Top cats: ${topCats.map(([c, v]) => `${c} ${R(v)}`).join(' · ')}`)
    if (parcelamentos > 0) sections.push(`  Parcelamentos ativos: ${parcelamentos}`)
    if (incomuns.length > 0) {
      const top3 = incomuns.slice(0, 3).map(t => `${t.descricao.slice(0, 25)} ${R(t.valor)}`).join(', ')
      sections.push(`  Compras incomuns: ${top3}`)
    }
  }

  return sections.join('\n')
}

// ─── Planejamento / Orçamento ─────────────────────────────────────────────────

function buildPlanejamentoLayer(m: FinancialInsightsContext): string {
  if (m.totalOrcado === 0) return ''

  const pctPago = Math.round((m.totalPago / m.totalOrcado) * 100)
  const lines = [
    `PLANEJAMENTO ${m.mesAtual}:`,
    `Orçado: ${R(m.totalOrcado)} | Pago: ${R(m.totalPago)} (${pctPago}%) | Em aberto: ${R(m.despesasEmAberto)}`,
  ]

  if (m.itensVencidos.length > 0) {
    const total = m.itensVencidos.reduce((s, i) => s + i.valor, 0)
    lines.push(`⚠️ VENCIDOS: ${m.itensVencidos.map(i => `${i.item} ${R(i.valor)}`).join(', ')} — total ${R(total)}`)
  }
  if (m.itensVencendo7d.length > 0) {
    lines.push(`Vencendo 7 dias: ${m.itensVencendo7d.map(i => `${i.item} ${R(i.valor)} (${i.vencimento})`).join(', ')}`)
  }
  const pendentes = m.itensPlanejamentoEmAberto.slice(0, 4)
  if (pendentes.length > 0) {
    lines.push(`Pendentes: ${pendentes.map(i => `${i.item} ${R(i.valor)}`).join(', ')}`)
  }

  return lines.join('\n')
}

// ─── Investimentos ────────────────────────────────────────────────────────────

function buildInvestimentosLayer(data: EnrichedData, m: FinancialInsightsContext): string {
  if (m.totalAportesHistorico === 0 && data.investimentos.length === 0) return ''

  const lines = ['INVESTIMENTOS:']
  if (m.totalAportesHistorico > 0) lines.push(`Total histórico aportado: ${R(m.totalAportesHistorico)}`)

  const invs = data.investimentos.slice(0, 5)
  if (invs.length > 0) lines.push(`Carteira: ${invs.map(i => `${i.descricao} ${i.percentual}%`).join(' · ')}`)

  const recentes = m.aportesRecentes.slice(0, 3)
  if (recentes.length > 0) lines.push(`Aportes recentes: ${recentes.map(a => `${a.descricao} ${R(a.valor)}`).join(' · ')}`)

  return lines.join('\n')
}

// ─── Assinaturas ──────────────────────────────────────────────────────────────

function buildAssinaturasLayer(data: EnrichedData, m: FinancialInsightsContext): string {
  if (m.assinaturasAtivas === 0) return ''
  const ativas = data.assinaturas.filter(a => a.ativa)
  const top3 = ativas.slice(0, 3).map(a => `${a.nome} ${R(a.valor)}`).join(' · ')
  return `ASSINATURAS: ${R(m.totalAssinaturas)}/mês | ${m.assinaturasAtivas} ativas\n${top3}`
}

// ─── Insights Ativos (regras, sem IA) ────────────────────────────────────────

function buildInsightsLayer(m: FinancialInsightsContext): string {
  const alerts: string[] = []

  if (m.mediaMensalHistorica > 0) {
    const vsH = ((m.totalGastos - m.mediaMensalHistorica) / m.mediaMensalHistorica) * 100
    if (vsH > 10) alerts.push(`⚠️ Gastos ${pct(vsH)} acima da média histórica`)
    else if (vsH < -5) alerts.push(`✅ Gastos ${pct(vsH)} abaixo da média histórica — bom controle`)
  }

  if (m.itensVencidos.length > 0) {
    const total = m.itensVencidos.reduce((s, i) => s + i.valor, 0)
    alerts.push(`⚠️ ${m.itensVencidos.length} despesa(s) vencida(s) — ${R(total)} em atraso`)
  }

  const top = m.topCategorias[0]
  if (top?.variacao !== undefined && top.variacao > 15) {
    alerts.push(`📈 ${top.categoria} cresceu ${pct(top.variacao)} vs mês anterior`)
  }

  if (m.itensVencendo7d.length > 0) {
    const total = m.itensVencendo7d.reduce((s, i) => s + i.valor, 0)
    alerts.push(`📅 ${m.itensVencendo7d.length} despesa(s) vencem esta semana — ${R(total)}`)
  }

  return alerts.length > 0 ? `INSIGHTS:\n${alerts.join('\n')}` : ''
}

// ─── Histórico Compacto ───────────────────────────────────────────────────────

function buildHistoricoCompactoLayer(data: EnrichedData, hoje: Date, nMeses = 5): string {
  const meses = Array.from({ length: nMeses }, (_, i) => format(subMonths(hoje, i + 1), 'yyyy-MM'))
  const entries = meses
    .map(m => {
      const total = sumTx(data.transacoes.filter(t => mesEfetivo(t) === m))
      return total > 0 ? `${fmtMes(m)}: ${R(total)}` : null
    })
    .filter(Boolean) as string[]

  return entries.length > 0 ? `HISTÓRICO RECENTE: ${entries.join(' · ')}` : ''
}

// ─── RAG Financeiro: Foco por Categoria (demanda explícita) ──────────────────

function buildCategoryFocusLayer(data: EnrichedData, categorias: string[], hoje: Date): string {
  if (categorias.length === 0) return ''

  const mesAtual = format(hoje, 'yyyy-MM')
  const mesesRange = Array.from({ length: 4 }, (_, i) => format(subMonths(hoje, i), 'yyyy-MM'))

  const relevant = data.transacoes.filter(t =>
    mesesRange.includes(mesEfetivo(t)) &&
    categorias.some(cat => (t.categoria ?? '') === cat)
  )
  if (relevant.length === 0) return ''

  const porMes: Record<string, number> = {}
  for (const t of relevant) {
    const m = mesEfetivo(t)
    porMes[m] = (porMes[m] ?? 0) + t.valor
  }

  const mensalStr = Object.entries(porMes)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([m, v]) => `${fmtMes(m)}: ${R(v)}`)
    .join(' · ')

  const topTx = relevant
    .filter(t => mesEfetivo(t) === mesAtual)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5)

  const lines = [`FOCO: ${categorias.join(' + ')}`, `Mensal: ${mensalStr}`]
  if (topTx.length > 0) {
    lines.push(`Maiores este mês: ${topTx.map(t => `${t.descricao.slice(0, 25)} ${R(t.valor)}`).join(' · ')}`)
  }
  return lines.join('\n')
}

// ─── Screen Context ───────────────────────────────────────────────────────────

const SCREEN_CONTEXT: Partial<Record<TelaAtual, string>> = {
  dashboard:      'Tela: Dashboard — visão geral, KPIs, tendências.',
  compras:        'Tela: Compras — transações e categorias.',
  financas:       'Tela: Finanças — planejamento vs realizado, vencimentos.',
  investimentos:  'Tela: Investimentos — carteira e aportes.',
  assinaturas:    'Tela: Assinaturas — serviços recorrentes.',
  receitas:       'Tela: Receitas — entradas financeiras.',
  analytics:      'Tela: Analytics — análises avançadas e tendências.',
}

// ─── Full Context (Primeira Mensagem) ────────────────────────────────────────

function buildFullContext(
  data: EnrichedData,
  m: FinancialInsightsContext,
  hoje: Date,
  tela?: TelaAtual
): string {
  const dateStr = format(hoje, "dd/MM/yyyy (EEEE)", { locale: ptBR })
  const screenCtx = tela ? SCREEN_CONTEXT[tela] ?? '' : ''

  const sections = [
    `Data: ${dateStr}${screenCtx ? ' | ' + screenCtx : ''}`,
    buildPerfilLayer(data),
    buildSnapshotLayer(m),
    buildIndicadoresLayer(m),
    buildTendenciasLayer(data, hoje),
    buildCardMotor(data, hoje),
    buildPlanejamentoLayer(m),
    buildInvestimentosLayer(data, m),
    buildAssinaturasLayer(data, m),
    buildInsightsLayer(m),
    buildHistoricoCompactoLayer(data, hoje),
  ].filter(s => s.length > 0)

  return sections.join('\n\n')
}

// ─── Focused Context (Mensagens Subsequentes) ─────────────────────────────────

function buildFocusedContext(
  data: EnrichedData,
  m: FinancialInsightsContext,
  domain: ContextDomain,
  pergunta: string,
  hoje: Date
): string {
  const dateStr = format(hoje, "dd/MM/yyyy", { locale: ptBR })
  const anchor = `Data: ${dateStr}\n[Contexto financeiro completo já estabelecido. Dados atuais para esta pergunta:]`

  let focus: string

  switch (domain) {
    case 'cartao':
      focus = [buildCardMotor(data, hoje), buildSnapshotLayer(m)].filter(Boolean).join('\n\n')
      break

    case 'investimentos':
      focus = buildInvestimentosLayer(data, m)
      break

    case 'orcamento':
      focus = buildPlanejamentoLayer(m)
      break

    case 'planejamento':
      focus = [buildSnapshotLayer(m), buildPlanejamentoLayer(m), buildInvestimentosLayer(data, m)]
        .filter(Boolean).join('\n\n')
      break

    case 'categoria': {
      const cats = detectCategorias(pergunta)
      focus = cats.length > 0
        ? buildCategoryFocusLayer(data, cats, hoje)
        : buildSnapshotLayer(m)
      break
    }

    case 'historico':
      focus = [buildHistoricoCompactoLayer(data, hoje, 6), buildIndicadoresLayer(m)].filter(Boolean).join('\n\n')
      break

    case 'insights':
      focus = [buildInsightsLayer(m), buildIndicadoresLayer(m), buildSnapshotLayer(m)].filter(Boolean).join('\n\n')
      break

    case 'geral':
    default:
      focus = [buildSnapshotLayer(m), buildIndicadoresLayer(m)].filter(Boolean).join('\n\n')
  }

  return [anchor, focus].filter(s => s.length > 0).join('\n\n')
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function buildChatContext({
  userId,
  pergunta,
  isFirstMessage,
  tela,
}: {
  userId: string
  pergunta: string
  isFirstMessage: boolean
  tela?: TelaAtual
}): Promise<string> {
  const data = await fetchEnrichedData(userId)
  const m = computeInsights(data)
  const hoje = new Date()

  if (isFirstMessage) {
    return buildFullContext(data, m, hoje, tela)
  }

  const domain = detectContextDomain(pergunta)
  return buildFocusedContext(data, m, domain, pergunta, hoje)
}
