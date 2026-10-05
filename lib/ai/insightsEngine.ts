// Pre-computes financial metrics from raw data to avoid raw data dumps to AI

import { format, subMonths, addMonths, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ehDespesaReal } from '@/lib/tipoCartao'
import { agoraBrasil } from './tempo'
import type {
  EnrichedData,
  FinancialInsightsContext,
  CategoryMetric,
  Transacao,
  Planejamento,
} from './types'

// Planning rows that are internal bookkeeping, not real (future) expenses —
// mirrors the exclusion list used by the financas page (calcularSaldo) and
// ChecklistMensal:
//   - [RECEITA]* / "Receita Total" → income entries, not expenses
//   - NuBank items                 → credit-card bill settlements
//   - [CARTAO1]* / [CARTAO2]*      → per-card instalment tracking rows
// Exported so other consumers of `planejamento` (e.g. the chat context's
// recurring-fixed-expense detection) don't have to re-derive this list and
// risk treating a settlement/tracking row as a real recurring bill.
//
// This used to be a hardcoded, case-sensitive Set that also omitted
// "NuBank Conjunto" — that row was counted as a real expense here while the
// dashboard excluded it. Delegating to the shared helper fixes both.
export function isPlanejamentoDespesaReal(item: string): boolean {
  return ehDespesaReal(item)
}

const fmtMes = (yyyyMM: string) => {
  try {
    return format(new Date(yyyyMM + '-02'), 'MMM/yyyy', { locale: ptBR }).toUpperCase()
  } catch {
    return yyyyMM
  }
}

function sumValor(lista: Transacao[]) {
  return lista.reduce((a, t) => a + t.valor, 0)
}

// Always use projeto_fatura (billing month) so the AI sees the same numbers
// as the app. Using data (purchase date) causes a mismatch when the billing
// cycle closes mid-month: purchases made after cut-off belong to the next bill.
export function getMesEfetivo(t: Transacao): string {
  return (t.projeto_fatura ?? t.data ?? '').substring(0, 7)
}

// Maps internal DB identifiers to human-readable card names shown in the app.
// Fallback for when the real name (set via planejamento "[CARTAO1]/[CARTAO2] <nome>") isn't available.
const CARTAO_NOMES: Record<string, string> = {
  nubank:  'Nubank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

/** Nome real de cartao1/cartao2 (ex.: "PicPay"), lido das linhas "[CARTAOx] <nome>" do planejamento já carregado. */
export function cartaoLabelsFromPlanejamento(planejamento: Planejamento[]): Record<string, string> {
  const c1 = planejamento.find(p => p.item.startsWith('[CARTAO1]'))?.item.replace('[CARTAO1]', '').trim()
  const c2 = planejamento.find(p => p.item.startsWith('[CARTAO2]'))?.item.replace('[CARTAO2]', '').trim()
  return { nubank: CARTAO_NOMES.nubank, cartao1: c1 || CARTAO_NOMES.cartao1, cartao2: c2 || CARTAO_NOMES.cartao2 }
}

export function nomeCartao(cartao: string | null | undefined, labels?: Record<string, string>): string {
  const id = cartao ?? 'nubank'
  return (labels ?? CARTAO_NOMES)[id] ?? id
}

export function computeInsights(data: EnrichedData, hoje: Date = agoraBrasil()): FinancialInsightsContext {
  const cartaoLabels = cartaoLabelsFromPlanejamento(data.planejamento)

  // Credit-card billing convention (mirrors the dashboard):
  //   mesCalendario = calendar month for planning queries (mes_referencia)
  //   mesFatura     = the billing period currently accumulating charges
  //
  // Purchases made AFTER the monthly closing date are assigned to the NEXT
  // calendar month's statement (projeto_fatura = next month).  The dashboard
  // shows this next-month period as the "current" fatura, so we do the same.
  //
  // Example (closing = 3rd, today = 7 June):
  //   June bill (2026-06) → closed 3 Jun → contains May-4 … Jun-3 purchases
  //   July bill (2026-07) → currently open → contains Jun-4 … now purchases  ← correct "current"
  const mesCalendario = format(hoje, 'yyyy-MM')           // for planejamento
  const mesFatura     = format(addMonths(hoje, 1), 'yyyy-MM')  // current open bill
  const mesFaturaAnterior = mesCalendario                  // last closed bill

  // Group by effective month: projeto_fatura for parcels, data for singles
  const byMes: Record<string, Transacao[]> = {}
  for (const t of data.transacoes) {
    const m = getMesEfetivo(t)
    if (!byMes[m]) byMes[m] = []
    byMes[m].push(t)
  }

  const txAtual    = byMes[mesFatura]         ?? []
  const txAnterior = byMes[mesFaturaAnterior] ?? []

  const totalGastos = sumValor(txAtual)
  // totalGastosAnterior and variacaoGastos are computed below, after
  // planTotalByCalMes is built (they need combined card + plan figures).

  // Spending by person
  const gastoMatheus = sumValor(txAtual.filter(t => t.responsavel === 'Matheus'))
  const gastoJeniffer = sumValor(txAtual.filter(t => t.responsavel === 'Jeniffer'))

  // Top categories with month-over-month comparison
  const catsAtual: Record<string, number> = {}
  const catsAnterior: Record<string, number> = {}
  for (const t of txAtual) {
    const cat = t.categoria || 'Sem categoria'
    catsAtual[cat] = (catsAtual[cat] ?? 0) + t.valor
  }
  for (const t of txAnterior) {
    const cat = t.categoria || 'Sem categoria'
    catsAnterior[cat] = (catsAnterior[cat] ?? 0) + t.valor
  }

  const topCategorias: CategoryMetric[] = Object.entries(catsAtual)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([categoria, valor]) => {
      // Use raw lookup so undefined means "no data last month", 0 means "zero spend"
      const anteriorRaw = catsAnterior[categoria]
      const anterior = anteriorRaw ?? 0
      const variacao = anterior > 0 ? ((valor - anterior) / anterior) * 100 : undefined
      return {
        categoria,
        valor,
        percentual: totalGastos > 0 ? (valor / totalGastos) * 100 : 0,
        anterior: anteriorRaw,
        variacao,
      }
    })

  // Biggest individual purchases this month
  const maioresGastos = [...txAtual]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
    .map(t => ({
      descricao: t.descricao,
      valor: t.valor,
      categoria: t.categoria ?? 'Sem categoria',
      responsavel: t.responsavel,
      cartao: nomeCartao(t.cartao, cartaoLabels),
    }))

  // Spending by card
  const gastoPorCartao: Record<string, number> = {}
  for (const t of txAtual) {
    const cartao = nomeCartao(t.cartao, cartaoLabels)
    gastoPorCartao[cartao] = (gastoPorCartao[cartao] ?? 0) + t.valor
  }

  // Installment purchases this month
  const parceladas = txAtual.filter(t => t.total_parcelas && t.total_parcelas > 1)
  const comprasParceladas = {
    count: parceladas.length,
    totalValor: sumValor(parceladas),
  }

  // Subscriptions
  const assinaturasAtivas = data.assinaturas.filter(a => a.ativa)
  const totalAssinaturas = assinaturasAtivas.reduce((s, a) => s + a.valor, 0)
  const assinaturasPorCategoria: Record<string, number> = {}
  for (const a of assinaturasAtivas) {
    assinaturasPorCategoria[a.categoria] = (assinaturasPorCategoria[a.categoria] ?? 0) + a.valor
  }

  // Planning for current calendar month — mirrors the exclusion list used by
  // the financas page (calcularSaldo) and ChecklistMensal:
  //   - [RECEITA]* / "Receita Total" → income entries, not expenses
  //   - NuBank items               → credit-card bill settlements
  //   - [CARTAO1]* / [CARTAO2]*   → per-card instalment tracking rows
  const planAtual = data.planejamento.filter(p => {
    if ((p.mes_referencia ?? '').substring(0, 7) !== mesCalendario) return false
    return isPlanejamentoDespesaReal(typeof p.item === 'string' ? p.item : '')
  })
  // Pagas contam pelo valor pago (valor_real), como a tela de Finanças; o
  // "em aberto" é o previsto do que ainda não foi pago.
  const paga = (p: Planejamento) => Boolean(p.data_pagamento || p.pago)
  const totalOrcado = planAtual.reduce((s, p) => s + p.valor_previsto, 0)
  const totalPago = planAtual
    .filter(paga)
    .reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
  const despesasEmAberto = planAtual
    .filter(p => !paga(p))
    .reduce((s, p) => s + p.valor_previsto, 0)

  // ── Planning totals for ALL months ───────────────────────────────────────────
  // Same exclusion rules as planAtual, across every mes_referencia.
  // Billing period M corresponds to calendar month subMonths(M, 1):
  //   mesFatura '2026-07' → calendar '2026-06' (current, = mesCalendario)
  //   meses6[0] '2026-06' → calendar '2026-05' (previous month)
  const planTotalByCalMes: Record<string, number> = {}
  for (const p of data.planejamento) {
    const calMes = (p.mes_referencia ?? '').substring(0, 7)
    if (!/^\d{4}-\d{2}$/.test(calMes)) continue   // skip rows with invalid/missing mes_referencia
    if (!isPlanejamentoDespesaReal(typeof p.item === 'string' ? p.item : '')) continue
    planTotalByCalMes[calMes] = (planTotalByCalMes[calMes] ?? 0) + (p.valor_previsto ?? 0)
  }
  // Use explicit year/month constructor to avoid timezone-related date shifts;
  // validate billingMes format first to prevent RangeError from date-fns.
  const planForBilling = (billingMes: string): number => {
    if (!billingMes || !/^\d{4}-\d{2}$/.test(billingMes)) return 0
    const [year, month] = billingMes.split('-').map(Number)
    return planTotalByCalMes[format(subMonths(new Date(year, month - 1, 2), 1), 'yyyy-MM')] ?? 0
  }

  // Card-only previous month total (matches what "Compras" tab shows for that month).
  const totalCartaoAnterior = sumValor(txAnterior)

  // Combined previous month total (card fatura + fixed planned expenses).
  // If a month has no card charges, the plan total alone is used.
  const totalGastosAnterior = totalCartaoAnterior + planForBilling(mesFaturaAnterior)

  // Variance uses combined totals (card + plan) so it matches what the
  // dashboard shows as "Gastos" for each month.
  const totalMesAtual = totalGastos + totalOrcado
  const variacaoGastos =
    totalMesAtual === 0 ? 0
    : totalGastosAnterior > 0
      ? ((totalMesAtual - totalGastosAnterior) / totalGastosAnterior) * 100
      : 0

  const rendaConfig = data.configuracoes.find(c => c.chave === 'renda_mensal')
  const rendaMensal = rendaConfig ? (parseFloat(rendaConfig.valor) || undefined) : undefined
  const sobraLiquida = rendaMensal !== undefined ? rendaMensal - totalMesAtual : undefined
  const taxaPoupanca = rendaMensal && rendaMensal > 0
    ? ((sobraLiquida ?? 0) / rendaMensal) * 100
    : undefined

  const diaAtual = hoje.getDate()
  const hojeStr = format(hoje, 'yyyy-MM-dd')
  const em7diasStr = format(addDays(hoje, 7), 'yyyy-MM-dd')

  const itensPlanejamentoEmAberto = planAtual
    .filter(p => !paga(p))
    .sort((a, b) => {
      if (a.data_vencimento && b.data_vencimento) return a.data_vencimento.localeCompare(b.data_vencimento)
      return 0
    })
    .slice(0, 5)
    .map(p => ({
      item: p.item,
      valor: p.valor_previsto,
      vencimento: p.data_vencimento ?? undefined,
    }))

  const itensVencidos = planAtual
    .filter(p => !paga(p) && p.data_vencimento && p.data_vencimento < hojeStr)
    .sort((a, b) => (a.data_vencimento ?? '').localeCompare(b.data_vencimento ?? ''))
    .slice(0, 5)
    .map(p => ({ item: p.item, valor: p.valor_previsto, vencimento: p.data_vencimento! }))

  const itensVencendo7d = planAtual
    .filter(p => !paga(p) && p.data_vencimento && p.data_vencimento >= hojeStr && p.data_vencimento <= em7diasStr)
    .sort((a, b) => (a.data_vencimento ?? '').localeCompare(b.data_vencimento ?? ''))
    .slice(0, 5)
    .map(p => ({ item: p.item, valor: p.valor_previsto, vencimento: p.data_vencimento! }))

  // Investments — only contributions made in the current calendar month are
  // included in aportesRecentes so that invRec in the compact payload is only
  // present when the user actually invested this month. Historical aportes
  // caused the AI to falsely report investment activity.
  const totalAportesHistorico = data.aportes.reduce((s, a) => s + a.valor, 0)
  const aportesDoMes = data.aportes.filter(
    a => (a.data_aporte ?? '').substring(0, 7) === mesCalendario
  )
  const aportesRecentes = [...aportesDoMes]
    .sort((a, b) => (b.data_aporte ?? '').localeCompare(a.data_aporte ?? ''))
    .slice(0, 5)
    .map(a => {
      const inv = data.investimentos.find(i => i.id === a.investimento_id)
      return {
        descricao: inv?.descricao ?? 'Investimento',
        valor: a.valor,
        data: a.data_aporte,
      }
    })

  // Historical average: last 6 closed billing periods (excludes current open bill)
  const meses6 = Array.from({ length: 6 }, (_, i) =>
    format(subMonths(addMonths(hoje, 1), i + 1), 'yyyy-MM')
  )
  // Combined historical totals: card fatura + planning for each billing period.
  // If a month had no card charges (e.g. a fully PIX month), only plan is counted.
  const totaisMeses6 = meses6.map(m => sumValor(byMes[m] ?? []) + planForBilling(m))
  const valoresMeses6ComDados = totaisMeses6.filter(v => v > 0)
  const mediaMensalHistorica =
    valoresMeses6ComDados.length > 0
      ? valoresMeses6ComDados.reduce((s, v) => s + v, 0) / valoresMeses6ComDados.length
      : 0

  // Card-only historical average: matches what "Compras" tab shows — no planning items.
  // Used for spending comparisons so the numbers align with what the user sees.
  const cartaoMeses6 = meses6.map(m => sumValor(byMes[m] ?? []))
  const valoresCartaoComDados = cartaoMeses6.filter(v => v > 0)
  const mediaCartaoHistorica =
    valoresCartaoComDados.length > 0
      ? valoresCartaoComDados.reduce((s, v) => s + v, 0) / valoresCartaoComDados.length
      : 0

  // Trend: last 3 months vs 3 months before (combined card + plan)
  // Average only over months with actual data; require ≥2 months per group to
  // avoid misleading percentages when the app has little historical data
  // (e.g. only 1 month in the older group would make the average 3× too low,
  // producing a false +100% signal).
  const u3 = meses6.slice(0, 3).map(m => sumValor(byMes[m] ?? []) + planForBilling(m))
  const a3 = meses6.slice(3, 6).map(m => sumValor(byMes[m] ?? []) + planForBilling(m))
  const u3Dados = u3.filter(v => v > 0)
  const a3Dados = a3.filter(v => v > 0)
  const mediaU3 = u3Dados.length > 0 ? u3Dados.reduce((s, v) => s + v, 0) / u3Dados.length : 0
  const mediaA3 = a3Dados.length > 0 ? a3Dados.reduce((s, v) => s + v, 0) / a3Dados.length : 0
  const tendenciaPct =
    u3Dados.length >= 2 && a3Dados.length >= 2 && mediaA3 > 0
      ? ((mediaU3 - mediaA3) / mediaA3) * 100
      : 0
  const tendencia =
    Math.abs(tendenciaPct) < 5 ? 'estavel' : tendenciaPct > 0 ? 'alta' : 'baixa'

  return {
    // Use calendar-month labels so the AI matches what the user sees in the dashboard
    // ("Junho 2026"), even though card transactions are filtered by billing period (mesFatura).
    mesAtual: fmtMes(mesCalendario),
    mesAnterior: fmtMes(format(subMonths(hoje, 1), 'yyyy-MM')),
    // The billing month totalGastos is actually keyed to — one month AHEAD
    // of mesAtual by convention (see comment above). Kept separate so
    // downstream text can say exactly which month a card figure belongs to.
    mesFaturaAtual: fmtMes(mesFatura),
    diaAtual,
    totalGastos,
    totalGastosAnterior,
    variacaoGastos,
    gastoMatheus,
    gastoJeniffer,
    topCategorias,
    maioresGastos,
    gastoPorCartao,
    comprasParceladas,
    totalAssinaturas,
    assinaturasAtivas: assinaturasAtivas.length,
    assinaturasPorCategoria,
    totalOrcado,
    totalPago,
    despesasEmAberto,
    itensPlanejamentoEmAberto,
    itensVencidos,
    itensVencendo7d,
    totalAportesHistorico,
    aportesRecentes,
    mediaMensalHistorica,
    mediaCartaoHistorica,
    totalCartaoAnterior,
    tendencia,
    tendenciaPct,
    rendaMensal,
    sobraLiquida,
    taxaPoupanca,
  }
}
