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

import { format, subMonths, addMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { fetchEnrichedData } from './contextBuilder'
import { computeInsights, getMesEfetivo as mesEfetivo, nomeCartao, cartaoLabelsFromPlanejamento } from './insightsEngine'
import {
  validateFinancialData,
  formatCertificateForAI,
  buildAntiDistortionSection,
  buildExplainabilitySection,
} from './financialValidationEngine'
import type { EnrichedData, FinancialInsightsContext, Transacao, Planejamento, TelaAtual } from './types'

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
  | 'receitas'      // renda, salário, receita, entrada de dinheiro
  | 'porPessoa'     // quem gastou mais, Matheus vs Jeniffer, top categorias de cada um
  | 'historico'     // comparar, histórico, mês passado, tendência
  | 'insights'      // problema, análise, principal, alerta
  | 'geral'         // fallback

export function detectContextDomain(pergunta: string): ContextDomain {
  const p = pergunta.toLowerCase()
  if (/fatura|parcel|cartão|cartao|compra cara|gastei demais/.test(p)) return 'cartao'
  if (/invest|aporte|carteira|patrimôni|patrimoni|rendimento/.test(p)) return 'investimentos'
  if (/receita|renda|salário|salario|recebimento|entrou\s*dinheiro/.test(p)) return 'receitas'
  if (/quem gast|matheus.*jeniffer|jeniffer.*matheus|cada um (dos dois)?|por responsáv|por responsav/.test(p)) return 'porPessoa'
  if (/orçamento|orcamento|previsto|budget|está pago|foi pago|paguei/.test(p)) return 'orcamento'
  if (/consigo|posso|viajar|economizar|reserva|emergência|emergencia|sobra|meta financ/.test(p)) return 'planejamento'
  if (/quanto gastei|gast.*com|quanto.*ifood|quanto.*uber|quanto.*netflix|quanto.*spotify|quanto.*mercado|quanto.*alimenta|quanto.*lazer/.test(p)) return 'categoria'
  if (/compar|histórico|historico|mês passado|mes passado|evolu|tendência|tendencia|antes/.test(p)) return 'historico'
  if (/problema|pior|análise|analise|principal|insight|piora|alerta|acima do normal|puxando|impulsionando|o que (está|esta) causando|por que.*(subiu|aumentou|cresceu|disparou|caiu)/.test(p)) return 'insights'
  return 'geral'
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
    `  Faturas cartão: ${R(m.totalGastos)} | Fixas planejadas: ${R(m.totalOrcado)}`,
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

function buildReceitasLayer(data: EnrichedData, hoje: Date): string {
  const receitas = data.planejamento.filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO))
  if (receitas.length === 0) return ''

  const mesCalendario = format(hoje, 'yyyy-MM')
  const nomeReceita = (p: Planejamento) => p.item.replace(RECEITA_PREFIXO, '')

  const doMes = receitas.filter(r => (r.mes_referencia ?? '').substring(0, 7) === mesCalendario)
  if (doMes.length === 0) return ''

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

  const lines = [
    `RECEITAS ${fmtMes(mesCalendario)}:`,
    `Previsto: ${R(totalPrevisto)} | Recebido: ${R(totalRecebido)} | Em aberto: ${R(totalEmAberto)}`,
  ]
  if (recorrentes.length > 0) {
    lines.push(`Recorrentes: ${recorrentes.map(r => `${nomeReceita(r)} ${R(r.valor_previsto)} (${r.responsavel ?? 'compartilhado'})`).join(' · ')}`)
  }
  if (extraordinarias.length > 0) {
    lines.push(`Extraordinárias/pontuais: ${extraordinarias.map(r => `${nomeReceita(r)} ${R(r.valor_previsto)}`).join(' · ')}`)
  }

  const futuras = receitas
    .filter(r => (r.mes_referencia ?? '').substring(0, 7) > mesCalendario)
    .sort((a, b) => (a.mes_referencia ?? '').localeCompare(b.mes_referencia ?? ''))
    .slice(0, 5)
  if (futuras.length > 0) {
    lines.push(`Futuras já cadastradas: ${futuras.map(r => `${nomeReceita(r)} ${R(r.valor_previsto)} (${fmtMes((r.mes_referencia ?? '').substring(0, 7))})`).join(' · ')}`)
  }

  return lines.join('\n')
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

  return entries.length > 0 ? `HISTÓRICO RECENTE: ${entries.join(' · ')}` : ''
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
  tela?: TelaAtual
): string {
  const dateStr = format(hoje, "dd/MM/yyyy (EEEE)", { locale: ptBR })
  const screenCtx = tela ? SCREEN_CONTEXT[tela] ?? '' : ''

  const sections = [
    `Data: ${dateStr}${screenCtx ? ' | ' + screenCtx : ''}`,
    buildPerfilLayer(data),
    buildCoreBundle(data, m, hoje),
    buildCardMotor(data, hoje),
    buildPlanejamentoLayer(m),
    buildReceitasLayer(data, hoje),
    buildInvestimentosLayer(data, m),
    buildInsightsLayer(m),
    buildHistoricoCompactoLayer(data, hoje),
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

function buildFocusedContext(
  data: EnrichedData,
  m: FinancialInsightsContext,
  domain: ContextDomain,
  pergunta: string,
  hoje: Date
): string {
  const dateStr = format(hoje, "dd/MM/yyyy", { locale: ptBR })
  const anchor = `Data: ${dateStr}\n[Contexto financeiro completo já estabelecido. Dados atuais para esta pergunta:]`
  const core = buildCoreBundle(data, m, hoje)

  let extra = ''

  switch (domain) {
    case 'cartao':
      extra = buildCardMotor(data, hoje)
      break

    case 'investimentos':
      extra = buildInvestimentosLayer(data, m)
      break

    case 'orcamento':
      extra = buildPlanejamentoLayer(m)
      break

    case 'receitas':
      extra = buildReceitasLayer(data, hoje)
      break

    case 'porPessoa':
      // Already in the core bundle (buildGastosPorPessoaLayer) — nothing extra.
      break

    case 'planejamento':
      extra = [buildPlanejamentoLayer(m), buildInvestimentosLayer(data, m)].filter(Boolean).join('\n\n')
      break

    case 'categoria': {
      const cats = detectCategorias(pergunta)
      extra = cats.length > 0 ? buildCategoryFocusLayer(data, cats, hoje) : ''
      break
    }

    case 'historico':
      extra = buildHistoricoCompactoLayer(data, hoje, 6)
      break

    case 'insights': {
      // Pulls actual purchases for the top 2 categories so "what's driving
      // this" can be answered with real line items, not just percentages.
      const topCats = m.topCategorias.slice(0, 2).map(c => c.categoria)
      extra = [buildInsightsLayer(m), buildCategoryFocusLayer(data, topCats, hoje)].filter(Boolean).join('\n\n')
      break
    }

    case 'geral':
    default:
      // Core bundle alone already covers the generic case.
      break
  }

  return [anchor, core, extra].filter(s => s.length > 0).join('\n\n')
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
  // Force a fresh read at the start of every conversation (RN04/CA03): the
  // user may have just logged an expense/income/investment/import on another
  // screen, and the assistant must never open on a stale snapshot. Follow-up
  // messages in the same conversation reuse the short-lived cache.
  const rawData = await fetchEnrichedData(userId, isFirstMessage)

  // ── Mandatory validation gate (RN11) ──────────────────────────────────────
  const { validatedData, certificate } = validateFinancialData(rawData)

  // Block severely compromised datasets (CA05)
  if (!certificate.certificado) {
    return [
      '⚠️ DADOS FINANCEIROS COM PROBLEMAS CRÍTICOS — ANÁLISE BLOQUEADA',
      formatCertificateForAI(certificate),
      'INSTRUÇÃO: Informe ao usuário que inconsistências críticas foram detectadas nos dados financeiros e que uma revisão é necessária antes de fornecer análises. Não tente gerar insights com estes dados.',
    ].join('\n\n')
  }

  const m    = computeInsights(validatedData)
  const hoje = new Date()

  if (isFirstMessage) {
    const baseCtx   = buildFullContext(validatedData, m, hoje, tela)
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

    return [baseCtx, antiDistortion, explainability, certBlock]
      .filter(s => s.length > 0)
      .join('\n\n')
  }

  const domain    = detectContextDomain(pergunta)
  const focusCtx  = buildFocusedContext(validatedData, m, domain, pergunta, hoje)
  const certLine  = formatCertificateForAI(certificate, true)

  return [focusCtx, certLine].filter(s => s.length > 0).join('\n\n')
}
