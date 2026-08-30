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

import { format, subMonths, addMonths, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { fetchEnrichedData } from './contextBuilder'
import { computeInsights, getMesEfetivo as mesEfetivo, nomeCartao, cartaoLabelsFromPlanejamento, isPlanejamentoDespesaReal } from './insightsEngine'
import {
  validateFinancialData,
  formatCertificateForAI,
  buildAntiDistortionSection,
  buildExplainabilitySection,
} from './financialValidationEngine'
import { buildContracts, buildContratosExtras, extrairParcelamento, type TransacaoRowParcelamento, type PlanejamentoRowParcelamento } from '../parcelamentoProjecao'
import type { EnrichedData, FinancialInsightsContext, Transacao, Planejamento, TelaAtual } from './types'
import { formatBRLCompacto } from '@/lib/format'

// ─── Formatters ───────────────────────────────────────────────────────────────

const R = formatBRLCompacto

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
  | 'receitas'      // renda, salário, receita, entrada de dinheiro
  | 'porPessoa'     // quem gastou mais, Matheus vs Jeniffer, top categorias de cada um
  | 'historico'     // comparar, histórico, mês passado, tendência
  | 'insights'      // problema, análise, principal, alerta
  | 'futuro'        // simulação, projeção, próximos meses, "consigo bancar X em dezembro"
  | 'geral'         // fallback

// All the domain names a caller (router or the Gemini function-calling tool)
// may legally request — used to validate LLM-supplied domain lists in route.ts.
export const KNOWN_DOMAINS: ContextDomain[] = [
  'cartao', 'investimentos', 'orcamento', 'planejamento', 'categoria',
  'receitas', 'porPessoa', 'historico', 'insights', 'futuro',
]

// Returns every domain the question plausibly touches (not just the first
// match) — a single message can legitimately span two domains ("cartão ou
// investimentos, o que pesa mais?"), and an if/return chain used to silently
// drop everything but the first hit.
export function detectContextDomains(pergunta: string): ContextDomain[] {
  const p = pergunta.toLowerCase()
  const domains: ContextDomain[] = []
  if (/fatura|parcel|cartão|cartao|compra cara|gastei demais/.test(p)) domains.push('cartao')
  if (/invest|aporte|carteira|patrimôni|patrimoni|rendimento/.test(p)) domains.push('investimentos')
  if (/receita|renda|salário|salario|recebimento|entrou\s*dinheiro/.test(p)) domains.push('receitas')
  if (/quem gast|matheus.*jeniffer|jeniffer.*matheus|cada um (dos dois)?|por responsáv|por responsav/.test(p)) domains.push('porPessoa')
  if (/orçamento|orcamento|previsto|budget|está pago|foi pago|paguei/.test(p)) domains.push('orcamento')
  if (/consigo|posso|viajar|economizar|reserva|emergência|emergencia|sobra|meta financ/.test(p)) domains.push('planejamento')
  if (/quanto gastei|gast.*com|quanto.*ifood|quanto.*uber|quanto.*netflix|quanto.*spotify|quanto.*mercado|quanto.*alimenta|quanto.*lazer/.test(p)) domains.push('categoria')
  if (/compar|histórico|historico|mês passado|mes passado|evolu|tendência|tendencia|antes|desde/.test(p)) domains.push('historico')
  if (/problema|pior|análise|analise|principal|insight|piora|alerta|acima do normal|puxando|impulsionando|o que (está|esta) causando|por que.*(subiu|aumentou|cresceu|disparou|caiu)/.test(p)) domains.push('insights')
  if (/simul|projeç|projec|próximo mês|proximo mes|mês que vem|mes que vem|daqui a \d|ano que vem|quanto vou ter|quanto (vai |vou )?sobrar|consigo (bancar|pagar|viajar) em|em (janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(p)) domains.push('futuro')
  return domains.length > 0 ? domains : ['geral']
}

const MESES_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

// Parses a Portuguese month name mentioned in the question (e.g. "desde
// Março") and returns how many billing periods back from the current
// fatura that month falls — used to widen buildHistoricoCompactoLayer's
// window dynamically instead of a fixed default that may silently exclude
// a month the user explicitly named. Assumes the most recent past
// occurrence of that month name (if it hasn't happened yet this calendar
// year, it must refer to last year).
function mesesAteReferencia(pergunta: string, hoje: Date): number | null {
  const p = pergunta.toLowerCase()
  let mesReferenciado: number | null = null
  for (const [nome, num] of Object.entries(MESES_PT)) {
    if (p.includes(nome)) { mesReferenciado = num; break }
  }
  if (mesReferenciado === null) return null

  const mesAtualNum = hoje.getMonth() + 1
  const anoRef = mesReferenciado > mesAtualNum ? hoje.getFullYear() - 1 : hoje.getFullYear()
  const dataRef = new Date(anoRef, mesReferenciado - 1, 1)
  const mesFaturaDate = startOfMonth(addMonths(hoje, 1))
  const diffMeses = (mesFaturaDate.getFullYear() - dataRef.getFullYear()) * 12 + (mesFaturaDate.getMonth() - dataRef.getMonth())
  return Math.max(1, diffMeses)
}

// Caps the dynamic window: never shrink below the existing default (5), and
// never grow past 12 months so a stray/old month mention can't blow up the
// context's token budget.
function resolveNMesesHistorico(pergunta: string, hoje: Date, fallback: number): number {
  const referencia = mesesAteReferencia(pergunta, hoje)
  return referencia === null ? fallback : Math.min(12, Math.max(fallback, referencia))
}

// Keys must match the real category names in CATEGORIAS_PADRAO (lib/categorias.ts)
// exactly — buildCategoryFocusLayer does a strict equality match against
// t.categoria, so a mismatched name here silently returns zero transactions.
function detectCategorias(pergunta: string): string[] {
  const p = pergunta.toLowerCase()
  const MAP: Record<string, string[]> = {
    'Alimentação': ['alimenta', 'comida', 'restaurante', 'ifood', 'delivery', 'lanche'],
    'Mercado': ['mercado', 'supermercado'],
    'Saúde': ['saúde', 'saude', 'médico', 'farmácia', 'farmacia', 'pilates', 'academia'],
    'Transporte': ['transporte', 'gasolina', 'uber', 'combustível', 'combustivel'],
    'Lazer': ['lazer', 'cinema', 'diversão', 'diversao', 'parque', 'show', 'bar', 'balada'],
    'Streaming': ['netflix', 'streaming', 'spotify', 'disney', 'hbo', 'amazon prime', 'max', 'youtube premium'],
    'Educação': ['educação', 'educacao', 'escola', 'curso', 'faculdade'],
    'Moradia': ['aluguel', 'condomínio', 'condominio', 'energia', 'internet', 'água', 'agua'],
    'Vestuário': ['roupa', 'vestuário', 'vestuario', 'calçado', 'calcado', 'moda', 'sapato', 'tênis', 'tenis'],
    'Tecnologia': ['tecnologia', 'celular', 'computador', 'eletrônico', 'eletronico', 'notebook', 'apple', 'samsung'],
    'Serviços': ['serviço', 'servico', 'manutenção', 'manutencao', 'reparo', 'conserto'],
    'Viagem': ['viagem', 'hotel', 'passagem', 'aéreo', 'aereo', 'turismo', 'airbnb'],
    'Pet': ['pet', 'veterinário', 'veterinario', 'ração', 'racao', 'petshop'],
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
  // totalMes = faturas cartão + fixas planejadas — same as "Gastos" on the dashboard
  const totalMes = m.totalGastos + m.totalOrcado
  const vsAnt = m.totalGastosAnterior > 0
    ? ` | vs ${m.mesAnterior}: ${R(m.totalGastosAnterior)} (${pct(m.variacaoGastos)})`
    : ''
  const vsHist = m.mediaMensalHistorica > 0
    ? ` | média 6m: ${R(m.mediaMensalHistorica)}`
    : ''
  const lines = [
    `SNAPSHOT ${m.mesAtual} (Dia ${m.diaAtual}):`,
    `Total do mês: ${R(totalMes)}${vsAnt}${vsHist}`,
    // Faturas cartão is the NEXT month's bill (mesFaturaAtual), not mesAtual
    // above — spelled out explicitly so the AI doesn't attribute this number
    // to the calendar month in the header.
    `  Faturas cartão (fatura de ${m.mesFaturaAtual}): ${R(m.totalGastos)} | Fixas planejadas (${m.mesAtual}): ${R(m.totalOrcado)}`,
    `  Por responsável (cartão): Matheus ${R(m.gastoMatheus)} | Jeniffer ${R(m.gastoJeniffer)}`,
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
  // Use billing-period reference so tendencies match card metrics
  const meses3    = Array.from({ length: 3 }, (_, i) => format(subMonths(addMonths(hoje, 1), i + 1), 'yyyy-MM'))
  const meses3ant = Array.from({ length: 3 }, (_, i) => format(subMonths(addMonths(hoje, 1), i + 4), 'yyyy-MM'))

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

// ─── Gastos por responsável × categoria ──────────────────────────────────────
// Snapshot layers only ever exposed per-person TOTALS (Matheus vs Jeniffer) or
// the overall #1 category — never a per-person category breakdown, so a
// simple "quem gastou mais em qual categoria?" had no data to answer from.

function buildGastosPorPessoaLayer(data: EnrichedData, hoje: Date): string {
  const mesFatura = format(addMonths(hoje, 1), 'yyyy-MM')
  const txAtual = data.transacoes.filter(t => mesEfetivo(t) === mesFatura)
  if (txAtual.length === 0) return ''

  const porPessoa: Record<string, Transacao[]> = {}
  for (const t of txAtual) {
    const resp = t.responsavel || 'Sem responsável'
    if (!porPessoa[resp]) porPessoa[resp] = []
    porPessoa[resp].push(t)
  }

  const linhas: string[] = []
  for (const [resp, txs] of Object.entries(porPessoa)) {
    const total = sumTx(txs)
    const cats: Record<string, number> = {}
    for (const t of txs) {
      const cat = t.categoria ?? 'Sem categoria'
      cats[cat] = (cats[cat] ?? 0) + t.valor
    }
    const top3 = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3)
    linhas.push(`${resp} (${R(total)}): ${top3.map(([c, v]) => `${c} ${R(v)}`).join(' · ')}`)
  }

  return linhas.length > 0 ? `GASTOS POR RESPONSÁVEL (top categorias):\n${linhas.join('\n')}` : ''
}

// ─── Vencimento por cartão ────────────────────────────────────────────────────
// dia_vencimento (Nubank/default) | dia_vencimento_cartao1 | dia_vencimento_cartao2

function diaVencimentoDoCartao(data: EnrichedData, cartaoRawId: string): number {
  const cfg = Object.fromEntries(data.configuracoes.map(c => [c.chave, c.valor]))
  const chave = cartaoRawId === 'nubank' ? 'dia_vencimento' : `dia_vencimento_${cartaoRawId}`
  const dia = parseInt(cfg[chave] ?? cfg['dia_vencimento'] ?? '10')
  return Number.isFinite(dia) && dia > 0 && dia <= 31 ? dia : 10
}

function proximoVencimento(mesFatura: string, diaVencimento: number): string {
  const [y, m] = mesFatura.split('-').map(Number)
  const ultimoDia = new Date(y, m, 0).getDate()
  const dia = Math.min(diaVencimento, ultimoDia)
  return format(new Date(y, m - 1, dia), 'dd/MM/yyyy')
}

// ─── Compras recorrentes (mesmo estabelecimento, não parcelado, não assinatura) ─

function normalizarDescCompra(desc: string): string {
  return (desc ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9á-úàâêôãõç\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectarComprasRecorrentes(
  txs: Transacao[],
  mesesConsiderados: string[]
): Array<{ nome: string; meses: number; mediaValor: number }> {
  const byDesc: Record<string, { nomeOriginal: string; valores: number[]; meses: Set<string> }> = {}
  for (const t of txs) {
    if (t.total_parcelas && t.total_parcelas > 1) continue // parcelamento, não recorrência
    const m = mesEfetivo(t)
    if (!mesesConsiderados.includes(m)) continue
    const key = normalizarDescCompra(t.descricao).slice(0, 40)
    if (!key) continue
    if (!byDesc[key]) byDesc[key] = { nomeOriginal: t.descricao, valores: [], meses: new Set() }
    byDesc[key].valores.push(t.valor)
    byDesc[key].meses.add(m)
  }
  return Object.values(byDesc)
    .filter(v => v.meses.size >= 3)
    .map(v => ({
      nome: v.nomeOriginal,
      meses: v.meses.size,
      mediaValor: v.valores.reduce((s, x) => s + x, 0) / v.valores.length,
    }))
    .sort((a, b) => b.meses - a.meses)
    .slice(0, 5)
}

// ─── Estornos (ajustes já refletidos na fatura) ──────────────────────────────

function buildEstornosSummary(data: EnrichedData, mesFatura: string, mesFaturaAnterior: string): string {
  if (data.estornos.length === 0) return ''

  const relevantes = data.estornos.filter(e => {
    const m = (e.projeto_fatura ?? '').substring(0, 7)
    return m === mesFatura || m === mesFaturaAnterior
  })
  if (relevantes.length === 0) return ''

  const cartaoLabels = cartaoLabelsFromPlanejamento(data.planejamento)
  const porCartao: Record<string, { count: number; total: number }> = {}
  for (const e of relevantes) {
    const c = nomeCartao(e.cartao, cartaoLabels)
    if (!porCartao[c]) porCartao[c] = { count: 0, total: 0 }
    porCartao[c].count++
    porCartao[c].total += Math.abs(e.valor)
  }

  const resumo = Object.entries(porCartao)
    .map(([c, v]) => `${c}: ${v.count} estorno(s) ${R(v.total)}`)
    .join(' | ')
  const exemplos = relevantes.slice(0, 3).map(e => `${e.descricao.slice(0, 30)} ${R(Math.abs(e.valor))}`).join(', ')

  return `Estornos: ${resumo} (já excluídos do total da fatura — não são gasto). Ex.: ${exemplos}`
}

// ─── Motor de Contexto de Cartões ────────────────────────────────────────────

function buildCardMotor(data: EnrichedData, hoje: Date): string {
  // Use the billing-period convention: the "current" fatura is always the
  // next calendar month (purchases after the closing date go to next month's bill).
  // This matches how the dashboard computes mesRefFatura = addMonths(mes, 1).
  const mesFatura = format(addMonths(hoje, 1), 'yyyy-MM')
  const mesFaturaAnterior = format(hoje, 'yyyy-MM')
  const txAtual = data.transacoes.filter(t => mesEfetivo(t) === mesFatura)
  if (txAtual.length === 0) return ''

  // Group by the raw card id (not the display name) so config lookups
  // (dia_vencimento_cartao1/2) and recurring-purchase detection stay correct.
  const porCartaoRaw: Record<string, Transacao[]> = {}
  for (const t of txAtual) {
    const id = t.cartao ?? 'nubank'
    if (!porCartaoRaw[id]) porCartaoRaw[id] = []
    porCartaoRaw[id].push(t)
  }

  // Last 4 billing periods (current + 3 prior), used for recurring-purchase detection
  const meses4 = Array.from({ length: 4 }, (_, i) => format(subMonths(addMonths(hoje, 1), i), 'yyyy-MM'))

  const sections: string[] = ['CARTÃO — FATURA ATUAL:']
  const cartaoLabels = cartaoLabelsFromPlanejamento(data.planejamento)

  for (const [cartaoId, txs] of Object.entries(porCartaoRaw)) {
    const cartao = nomeCartao(cartaoId, cartaoLabels)
    const total = sumTx(txs)

    // 6 most recent closed billing periods for the historical average
    const totais6m = Array.from({ length: 6 }, (_, i) => {
      const m = format(subMonths(addMonths(hoje, 1), i + 1), 'yyyy-MM')
      return sumTx(data.transacoes.filter(t => mesEfetivo(t) === m && (t.cartao ?? 'nubank') === cartaoId))
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

    const diaVenc = diaVencimentoDoCartao(data, cartaoId)
    const vencimento = proximoVencimento(mesFatura, diaVenc)

    const txsRecorrencia = data.transacoes.filter(t => (t.cartao ?? 'nubank') === cartaoId)
    const recorrentes = detectarComprasRecorrentes(txsRecorrencia, meses4)

    sections.push(`${cartao}: ${R(total)} | média 6m: ${R(media6m)} | ${pct(varPct)} | vencimento: ${vencimento}`)
    sections.push(`  Top cats: ${topCats.map(([c, v]) => `${c} ${R(v)}`).join(' · ')}`)
    if (parcelamentos > 0) sections.push(`  Parcelamentos ativos: ${parcelamentos}`)
    if (incomuns.length > 0) {
      const top3 = incomuns.slice(0, 3).map(t => `${t.descricao.slice(0, 25)} ${R(t.valor)}`).join(', ')
      sections.push(`  Compras incomuns: ${top3}`)
    }
    if (recorrentes.length > 0) {
      const lista = recorrentes.map(r => `${r.nome.slice(0, 25)} (${r.meses}/4 meses, ~${R(r.mediaValor)})`).join(', ')
      sections.push(`  Compras recorrentes: ${lista}`)
    }
  }

  const estornos = buildEstornosSummary(data, mesFatura, mesFaturaAnterior)
  if (estornos) sections.push(estornos)

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

// ─── Receitas ([RECEITA]* dentro de planejamento) ────────────────────────────

const RECEITA_PREFIXO = '[RECEITA] '

// Shared by buildReceitasLayer (follow-up on the receitas domain) and
// buildFuturoLayer (projection needs future income, not just future expenses,
// to answer "will I have enough?").
function buildFuturasReceitasList(data: EnrichedData, hoje: Date, limit = 5): Array<{ nome: string; valor: number; mes: string }> {
  const mesCalendario = format(hoje, 'yyyy-MM')
  const receitas = data.planejamento.filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO))
  return receitas
    .filter(r => (r.mes_referencia ?? '').substring(0, 7) > mesCalendario)
    .sort((a, b) => (a.mes_referencia ?? '').localeCompare(b.mes_referencia ?? ''))
    .slice(0, limit)
    .map(r => ({
      nome: r.item.replace(RECEITA_PREFIXO, ''),
      valor: r.valor_previsto,
      mes: (r.mes_referencia ?? '').substring(0, 7),
    }))
}

function buildReceitasLayer(data: EnrichedData, hoje: Date): string {
  const receitas = data.planejamento.filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO))
  if (receitas.length === 0) return ''

  const mesCalendario = format(hoje, 'yyyy-MM')
  const nomeReceita = (p: Planejamento) => p.item.replace(RECEITA_PREFIXO, '')

  const doMes = receitas.filter(r => (r.mes_referencia ?? '').substring(0, 7) === mesCalendario)

  const lines: string[] = []

  // Note: this used to `return ''` here when the current month had no
  // receita rows — which silently dropped the "futuras" block below too,
  // hiding already-registered future income (e.g. December) whenever the
  // current month simply hadn't been logged yet.
  if (doMes.length > 0) {
    const totalPrevisto = doMes.reduce((s, r) => s + r.valor_previsto, 0)
    const recebidas = doMes.filter(r => r.pago)
    const totalRecebido = recebidas.reduce((s, r) => s + (r.valor_real ?? r.valor_previsto), 0)
    const emAberto = doMes.filter(r => !r.pago)
    const totalEmAberto = emAberto.reduce((s, r) => s + r.valor_previsto, 0)

    // Recorrente: mesmo nome aparece em ≥2 dos últimos 3 meses (incluindo o atual)
    const meses3 = Array.from({ length: 3 }, (_, i) => format(subMonths(hoje, i), 'yyyy-MM'))
    const contagemPorNome: Record<string, number> = {}
    for (const r of receitas) {
      if (!meses3.includes((r.mes_referencia ?? '').substring(0, 7))) continue
      const n = nomeReceita(r)
      contagemPorNome[n] = (contagemPorNome[n] ?? 0) + 1
    }
    const recorrentes = doMes.filter(r => (contagemPorNome[nomeReceita(r)] ?? 0) >= 2)
    const extraordinarias = doMes.filter(r => (contagemPorNome[nomeReceita(r)] ?? 0) < 2)

    lines.push(`RECEITAS ${fmtMes(mesCalendario)}:`)
    lines.push(`Previsto: ${R(totalPrevisto)} | Recebido: ${R(totalRecebido)} | Em aberto: ${R(totalEmAberto)}`)
    if (recorrentes.length > 0) {
      lines.push(`Recorrentes: ${recorrentes.map(r => `${nomeReceita(r)} ${R(r.valor_previsto)} (${r.responsavel ?? 'compartilhado'})`).join(' · ')}`)
    }
    if (extraordinarias.length > 0) {
      lines.push(`Extraordinárias/pontuais: ${extraordinarias.map(r => `${nomeReceita(r)} ${R(r.valor_previsto)}`).join(' · ')}`)
    }
  } else {
    lines.push(`RECEITAS ${fmtMes(mesCalendario)}: nenhuma receita cadastrada este mês.`)
  }

  const futuras = buildFuturasReceitasList(data, hoje)
  if (futuras.length > 0) {
    lines.push(`Futuras já cadastradas: ${futuras.map(r => `${r.nome} ${R(r.valor)} (${fmtMes(r.mes)})`).join(' · ')}`)
  }

  return lines.join('\n')
}

// ─── Projeção / Futuro (compromissos já assumidos, projetados N meses) ──────
// Reaproveita o motor de reconstrução de parcelas/fixos usado por /api/projection
// (lib/parcelamentoProjecao.ts) em vez de duplicar a matemática — mesma
// convenção de "fatura atual = addMonths(hoje, 1)" usada no resto deste arquivo.

// buildContracts dedupes rows into "one contract per purchase" by a key that
// includes the exact valor — safe when fed a single-bill snapshot (one row
// per active installment, as /api/projection/route.ts does), but NOT when
// fed multi-month history directly: if a card's monthly installment value
// drifts by even a cent between months (interest/rounding, common on
// imported statements), each historical occurrence gets its own key and
// survives as a separate "contract", so the same real purchase gets counted
// once per surviving variant for every future month — the exact cause of the
// projection being inflated. Restricting to each card's most recent billing
// period (mirroring the dashboard's /api/projection selection) guarantees
// exactly one row per active installment again.
function ultimaFaturaSnapshot(transacoes: Transacao[]): Transacao[] {
  const maxPorCartao: Record<string, string> = {}
  for (const t of transacoes) {
    const cartaoId = t.cartao ?? 'nubank'
    const mes = mesEfetivo(t)
    if (!maxPorCartao[cartaoId] || mes > maxPorCartao[cartaoId]) maxPorCartao[cartaoId] = mes
  }
  return transacoes.filter(t => mesEfetivo(t) === maxPorCartao[t.cartao ?? 'nubank'])
}

// buildContratosExtras only recognizes planejamento rows with explicit
// installment metadata (parcela_atual/total_parcelas, or an "N/M" pattern in
// the item text) — see extrairParcelamento. Ordinary recurring fixed bills
// (aluguel, condomínio, internet) that get logged as a fresh single row each
// month have neither, so they're invisible to the projection below, silently
// understating real future commitments for exactly the "posso bancar X"
// questions this layer exists to answer. Detected the same way
// buildReceitasLayer detects recurring income: same item name appearing in
// ≥2 of the last 3 months, using only rows extrairParcelamento couldn't
// already attribute to an installment (avoids double-counting with
// buildContratosExtras).
function mediaFixosRecorrentesSemParcela(planejamento: Planejamento[], hoje: Date): number {
  // isPlanejamentoDespesaReal excludes internal bookkeeping rows (NuBank bill
  // settlements, [CARTAO1]/[CARTAO2] tracking labels) — without it, those
  // rows (which naturally have no parcela metadata either) would get
  // mistaken for a recurring monthly bill and inflate every future month.
  const semParcela = planejamento.filter(p =>
    isPlanejamentoDespesaReal(p.item ?? '') && !extrairParcelamento({ ...p, descricao: p.item })
  )
  const meses3 = Array.from({ length: 3 }, (_, i) => format(subMonths(hoje, i), 'yyyy-MM'))
  const porNome: Record<string, number[]> = {}
  for (const p of semParcela) {
    if (!meses3.includes((p.mes_referencia ?? '').substring(0, 7))) continue
    const nome = p.item ?? ''
    if (!nome) continue
    if (!porNome[nome]) porNome[nome] = []
    porNome[nome].push(p.valor_previsto)
  }
  let total = 0
  for (const valores of Object.values(porNome)) {
    if (valores.length >= 2) total += valores.reduce((s, v) => s + v, 0) / valores.length
  }
  return total
}

function buildFuturoLayer(
  data: EnrichedData,
  m: FinancialInsightsContext,
  hoje: Date,
  mesesAFrente = 3,
  // buildFullContext already renders buildReceitasLayer (which includes the
  // same "Futuras já cadastradas" list) right above this layer — skip it
  // there to avoid sending the identical block twice in the first message.
  // The domain-triggered follow-up call (buildDomainExtra) keeps it, since
  // buildReceitasLayer isn't necessarily included that turn.
  incluirReceitasFuturas = true
): string {
  const planejamentoSemReceita = data.planejamento.filter(p => !(p.item ?? '').startsWith(RECEITA_PREFIXO))
  // Transacao/Planejamento are structurally compatible with the projection
  // engine's looser row types (same fields, plus extras) but TS requires an
  // explicit index signature match — cast rather than widen the shared types.
  const contratos = buildContracts(ultimaFaturaSnapshot(data.transacoes) as unknown as TransacaoRowParcelamento[])
  const contratosExtras = buildContratosExtras(planejamentoSemReceita as unknown as PlanejamentoRowParcelamento[])
  const fixosRecorrentes = mediaFixosRecorrentesSemParcela(planejamentoSemReceita, hoje)

  const linhas: string[] = []
  for (let i = 0; i < mesesAFrente; i++) {
    const mesRef = startOfMonth(addMonths(hoje, 1 + i))

    // The immediately upcoming billing/planning period (mesFatura/mesCalendario)
    // already has real, complete data — m.totalGastos (buildCardMotor) and
    // m.totalOrcado (buildPlanejamentoLayer) — including one-off card
    // purchases and non-installment fixed items already posted this cycle.
    // Reconstructing it from buildContracts/buildContratosExtras instead
    // would silently show a LOWER, contradictory number for the same month
    // right next to the real one elsewhere in the same context.
    if (i === 0) {
      const totalMes = m.totalGastos + m.totalOrcado + m.totalAssinaturas
      // "SNAPSHOT" is the one section guaranteed present alongside this layer
      // in every context (first message AND every follow-up, via the core
      // bundle) — CARTÃO/PLANEJAMENTO are only present on some turns, so
      // naming them here would sometimes point at a section that isn't there.
      linhas.push(`${fmtMes(format(mesRef, 'yyyy-MM'))}: ${R(totalMes)} (mesmo total já mostrado em SNAPSHOT — dado real, não é uma projeção)`)
      continue
    }

    let totalParcelas = 0
    let totalFixos = 0

    for (const { row, fatura, parcela } of contratos.values()) {
      const deltaM = (mesRef.getFullYear() - fatura.getFullYear()) * 12 + (mesRef.getMonth() - fatura.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) totalParcelas += row.valor ?? 0
    }

    for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
      const mesesDiff = (mesRef.getFullYear() - mesExtra.getFullYear()) * 12 + (mesRef.getMonth() - mesExtra.getMonth())
      const restantes = parcela.total - parcela.atual + 1
      if (mesesDiff >= 0 && mesesDiff < restantes) totalFixos += e.valor_previsto ?? 0
    }

    // Assinaturas ativas não entram em buildContracts/buildContratosExtras
    // (não são parceladas nem têm mes_referencia) — somadas à parte como
    // recorrência fixa em todo mês projetado.
    const totalFixosCompleto = totalFixos + fixosRecorrentes
    const totalMes = totalParcelas + totalFixosCompleto + m.totalAssinaturas
    linhas.push(`${fmtMes(format(mesRef, 'yyyy-MM'))}: ${R(totalMes)} (parcelas ${R(totalParcelas)} + fixos ${R(totalFixosCompleto)} + assinaturas ${R(m.totalAssinaturas)})`)
  }

  const sections = [`PROJEÇÃO (próximos ${mesesAFrente} meses):`, linhas.join(' · ')]

  if (incluirReceitasFuturas) {
    const futurasReceitas = buildFuturasReceitasList(data, hoje, 5)
    if (futurasReceitas.length > 0) {
      sections.push(`Receitas futuras já cadastradas: ${futurasReceitas.map(r => `${r.nome} ${R(r.valor)} (${fmtMes(r.mes)})`).join(' · ')}`)
    }
  }

  sections.push('Projeção baseada apenas em compromissos já assumidos (parcelas abertas, fixos planejados, assinaturas ativas) — não inclui gastos discricionários futuros.')

  return sections.join('\n')
}

// ─── Insights Ativos (regras, sem IA) ────────────────────────────────────────

function buildInsightsLayer(m: FinancialInsightsContext): string {
  const alerts: string[] = []

  if (m.mediaCartaoHistorica > 0) {
    const vsH = ((m.totalGastos - m.mediaCartaoHistorica) / m.mediaCartaoHistorica) * 100
    if (vsH > 10) alerts.push(`⚠️ Compras no cartão ${pct(vsH)} acima da média histórica`)
    else if (vsH < -5 && m.diaAtual >= 20) alerts.push(`✅ Compras no cartão ${pct(vsH)} abaixo da média histórica — bom controle`)
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
  // Billing-period reference: most recent closed bills first
  const meses = Array.from({ length: nMeses }, (_, i) => format(subMonths(addMonths(hoje, 1), i + 1), 'yyyy-MM'))
  const entries = meses
    .map(m => {
      const total = sumTx(data.transacoes.filter(t => mesEfetivo(t) === m))
      return total > 0 ? `${fmtMes(m)}: ${R(total)}` : null
    })
    .filter(Boolean) as string[]

  // Explicit "somente cartão" qualifier: this sums data.transacoes only,
  // never data.planejamento — without saying so, the LLM has no way to tell
  // these figures apart from the combined (cartão + fixas) "Total do mês"
  // shown in SNAPSHOT, and can wrongly assume it lacks card-only history it
  // was actually given.
  return entries.length > 0
    ? `HISTÓRICO CARTÃO (somente faturas de cartão, não inclui despesas fixas planejadas): ${entries.join(' · ')}`
    : ''
}

// ─── RAG Financeiro: Foco por Categoria (demanda explícita) ──────────────────

function buildCategoryFocusLayer(data: EnrichedData, categorias: string[], hoje: Date): string {
  if (categorias.length === 0) return ''

  const mesFatura  = format(addMonths(hoje, 1), 'yyyy-MM')
  const mesesRange = Array.from({ length: 4 }, (_, i) => format(subMonths(addMonths(hoje, 1), i), 'yyyy-MM'))

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
    .filter(t => mesEfetivo(t) === mesFatura)
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
  pergunta: string,
  tela?: TelaAtual
): string {
  const dateStr = format(hoje, "dd/MM/yyyy (EEEE)", { locale: ptBR })
  const screenCtx = tela ? SCREEN_CONTEXT[tela] ?? '' : ''

  // If the very first message already names a month ("...desde Março"), the
  // fixed 5-month default can silently exclude it — widen the window to
  // reach it instead of relying on the follow-up-only 'historico' domain
  // path (which this first message never goes through).
  const nMesesHistorico = resolveNMesesHistorico(pergunta, hoje, 5)

  const sections = [
    `Data: ${dateStr}${screenCtx ? ' | ' + screenCtx : ''}`,
    buildPerfilLayer(data),
    buildCoreBundle(data, m, hoje),
    buildCardMotor(data, hoje),
    buildPlanejamentoLayer(m),
    buildReceitasLayer(data, hoje),
    buildInvestimentosLayer(data, m),
    buildInsightsLayer(m),
    buildHistoricoCompactoLayer(data, hoje, nMesesHistorico),
    buildFuturoLayer(data, m, hoje, 3, /* incluirReceitasFuturas */ false),
  ].filter(s => s.length > 0)

  return sections.join('\n\n')
}

// ─── Core bundle (sent on EVERY follow-up message, regardless of domain) ─────
// The domain regexes below are a hand-written approximation of intent — they
// will never anticipate every phrasing. Rather than gate summary-level data
// behind guessing the "right" keyword, every follow-up gets this compact
// baseline: totals, per-person split, top categories (overall AND per
// person), trend direction, budget/vencimento status and subscriptions.
// This alone answers the large majority of "anything the user might ask"
// questions. Anything heavier — line-item purchases, investment portfolio
// detail, receitas breakdown, card-level recurring/estornos — stays gated
// behind the domain-specific "extra" below so token cost doesn't balloon on
// every single message (RN03).
function buildCoreBundle(data: EnrichedData, m: FinancialInsightsContext, hoje: Date): string {
  return [
    buildSnapshotLayer(m),
    buildIndicadoresLayer(m),
    buildTendenciasLayer(data, hoje),
    buildGastosPorPessoaLayer(data, hoje),
    buildAssinaturasLayer(data, m),
  ].filter(Boolean).join('\n\n')
}

// ─── Focused Context (Mensagens Subsequentes) ─────────────────────────────────

// Renders the "extra" (domain-specific) block for a single domain. Exported
// so both the multi-domain router below AND the Gemini function-calling
// fallback in route.ts (Fase C) can render a domain on demand from the same
// already-fetched data/metrics, without duplicating this dispatch logic.
export function buildDomainExtra(
  domain: ContextDomain,
  data: EnrichedData,
  m: FinancialInsightsContext,
  pergunta: string,
  hoje: Date
): string {
  switch (domain) {
    case 'cartao':
      return buildCardMotor(data, hoje)

    case 'investimentos':
      return buildInvestimentosLayer(data, m)

    case 'orcamento':
      return buildPlanejamentoLayer(m)

    case 'receitas':
      return buildReceitasLayer(data, hoje)

    case 'porPessoa':
      // Already in the core bundle (buildGastosPorPessoaLayer) — nothing extra.
      return ''

    case 'planejamento':
      return [buildPlanejamentoLayer(m), buildInvestimentosLayer(data, m)].filter(Boolean).join('\n\n')

    case 'categoria': {
      const cats = detectCategorias(pergunta)
      return cats.length > 0 ? buildCategoryFocusLayer(data, cats, hoje) : ''
    }

    case 'historico':
      return buildHistoricoCompactoLayer(data, hoje, resolveNMesesHistorico(pergunta, hoje, 6))

    case 'insights': {
      // Pulls actual purchases for the top 2 categories so "what's driving
      // this" can be answered with real line items, not just percentages.
      const topCats = m.topCategorias.slice(0, 2).map(c => c.categoria)
      return [buildInsightsLayer(m), buildCategoryFocusLayer(data, topCats, hoje)].filter(Boolean).join('\n\n')
    }

    case 'futuro':
      return buildFuturoLayer(data, m, hoje, 6)

    case 'geral':
    default:
      // Core bundle alone already covers the generic case.
      return ''
  }
}

// Priority order used to cap how many domains get rendered per follow-up
// turn — a message can match several domains (Fase B), but rendering all of
// them would blow the "focused" token budget. 'porPessoa' has no extra block
// (already in the core bundle) so it never consumes a cap slot in practice.
const DOMAIN_PRIORITY: ContextDomain[] = [
  'cartao', 'futuro', 'investimentos', 'planejamento', 'orcamento',
  'receitas', 'categoria', 'historico', 'insights', 'porPessoa',
]
const MAX_DOMAINS_RENDERED = 2

function capDomains(domains: ContextDomain[]): ContextDomain[] {
  const unique = [...new Set(domains)].filter(d => d !== 'geral')
  return unique
    .sort((a, b) => DOMAIN_PRIORITY.indexOf(a) - DOMAIN_PRIORITY.indexOf(b))
    .slice(0, MAX_DOMAINS_RENDERED)
}

// Domains the LLM may still want but didn't get this turn — surfaced via
// Fase C's tool hint. Kept proportional to what's actually missing instead
// of a constant full menu on every follow-up (that would add fixed token
// overhead to every turn, defeating the "on demand" point of Fase C):
//  - router matched nothing (['geral']): offer the full domain space, since
//    this is exactly the "unanticipated phrasing" case the tool exists for.
//  - router matched something: only the domains the render cap cut, if any
//    — usually empty, so the hint costs nothing on the common path.
export function domainsNotRendered(domains: ContextDomain[]): ContextDomain[] {
  const rendered = new Set(capDomains(domains))
  if (domains.includes('geral')) {
    return KNOWN_DOMAINS.filter(d => !rendered.has(d))
  }
  return [...new Set(domains)].filter(d => d !== 'geral' && !rendered.has(d))
}

function buildFocusedContext(
  data: EnrichedData,
  m: FinancialInsightsContext,
  domains: ContextDomain[],
  pergunta: string,
  hoje: Date
): string {
  const dateStr = format(hoje, "dd/MM/yyyy", { locale: ptBR })
  const anchor = `Data: ${dateStr}\n[Contexto financeiro completo já estabelecido. Dados atuais para esta pergunta:]`
  const core = buildCoreBundle(data, m, hoje)

  const extras = capDomains(domains)
    .map(d => buildDomainExtra(d, data, m, pergunta, hoje))
    .filter(Boolean)
  // String-level dedup: e.g. 'orcamento' and 'planejamento' both render
  // buildPlanejamentoLayer(m) — avoid sending the identical block twice.
  const dedupedExtras = [...new Set(extras)]

  return [anchor, core, ...dedupedExtras].filter(s => s.length > 0).join('\n\n')
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export interface ChatContextResult {
  context: string
  // true when the validation certificate blocked analysis (CA05) — route.ts
  // must not enable the Fase C function-calling tool in this case, since it
  // would be nonsensical for the model to "ask for more" already-flagged data.
  blocked: boolean
  data?: EnrichedData
  metrics?: FinancialInsightsContext
  hoje?: Date
  // Domains left out of this turn's focused context due to the render cap —
  // route.ts surfaces these to the model as what it may request via the tool.
  domainsDisponiveis?: ContextDomain[]
}

export async function buildChatContext({
  userId,
  pergunta,
  isFirstMessage,
  tela,
  perguntaAnterior,
}: {
  userId: string
  pergunta: string
  isFirstMessage: boolean
  tela?: TelaAtual
  perguntaAnterior?: string
}): Promise<ChatContextResult> {
  // Force a fresh read at the start of every conversation (RN04/CA03): the
  // user may have just logged an expense/income/investment/import on another
  // screen, and the assistant must never open on a stale snapshot. Follow-up
  // messages in the same conversation reuse the short-lived cache.
  const rawData = await fetchEnrichedData(userId, isFirstMessage)

  // ── Mandatory validation gate (RN11) ──────────────────────────────────────
  const { validatedData, certificate } = validateFinancialData(rawData)

  // Block severely compromised datasets (CA05)
  if (!certificate.certificado) {
    const context = [
      '⚠️ DADOS FINANCEIROS COM PROBLEMAS CRÍTICOS — ANÁLISE BLOQUEADA',
      formatCertificateForAI(certificate),
      'INSTRUÇÃO: Informe ao usuário que inconsistências críticas foram detectadas nos dados financeiros e que uma revisão é necessária antes de fornecer análises. Não tente gerar insights com estes dados.',
    ].join('\n\n')
    return { context, blocked: true }
  }

  const m    = computeInsights(validatedData)
  const hoje = new Date()

  if (isFirstMessage) {
    const baseCtx   = buildFullContext(validatedData, m, hoje, pergunta, tela)
    const certBlock = formatCertificateForAI(certificate)

    // Anti-distortion motor (RN13): uses combined total (card + plan) so it
    // matches the "Gastos" figure the user sees on the dashboard.
    const antiDistortion = buildAntiDistortionSection(
      m.totalGastos + m.totalOrcado,
      m.totalGastosAnterior,
      m.mediaMensalHistorica,
      m.mesAtual,
      m.mesAnterior
    )

    // Explainability metadata (RN19)
    const explainability = buildExplainabilitySection(
      m.topCategorias,
      m.mesAtual,
      m.mesAnterior
    )

    const context = [baseCtx, antiDistortion, explainability, certBlock]
      .filter(s => s.length > 0)
      .join('\n\n')

    return { context, blocked: false, data: validatedData, metrics: m, hoje }
  }

  // Fase B: union of domains from the current message + the immediately
  // preceding user message (bounded to exactly one turn of lookback, so
  // short-range topic continuity — "e por categoria?" right after a cartão
  // question — resolves without unbounded drift across the conversation).
  const domainsAtual    = detectContextDomains(pergunta)
  const domainsAnterior = perguntaAnterior ? detectContextDomains(perguntaAnterior) : []
  const domains         = [...new Set([...domainsAtual, ...domainsAnterior])]

  const focusCtx = buildFocusedContext(validatedData, m, domains, pergunta, hoje)
  const certLine = formatCertificateForAI(certificate, true)
  const domainsDisponiveis = domainsNotRendered(domains)

  // Tells the model what it may ask for via buscar_dados_financeiros instead
  // of it having to guess whether an absent section means "doesn't exist" —
  // this line is what makes Fase C's tool actually get used instead of the
  // model defaulting to "não tenho esse dado".
  const menu = domainsDisponiveis.length > 0
    ? `DOMÍNIOS DISPONÍVEIS SOB DEMANDA (via buscar_dados_financeiros, se necessário para responder): ${domainsDisponiveis.join(', ')}`
    : ''

  const context = [focusCtx, menu, certLine].filter(s => s.length > 0).join('\n\n')

  return {
    context,
    blocked: false,
    data: validatedData,
    metrics: m,
    hoje,
    domainsDisponiveis,
  }
}
