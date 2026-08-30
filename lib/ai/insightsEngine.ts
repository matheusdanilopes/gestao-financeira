// Pre-computes financial metrics from raw data to avoid raw data dumps to AI

import { format, subMonths, addMonths, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ehDespesaReal } from '@/lib/tipoCartao'
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

export function computeInsights(data: EnrichedData): FinancialInsightsContext {
  const hoje = new Date()
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
  const totalOrcado = planAtual.reduce((s, p) => s + p.valor_previsto, 0)
  const totalPago = planAtual
    .filter(p => p.data_pagamento)
    .reduce((s, p) => s + p.valor_previsto, 0)
  const despesasEmAberto = totalOrcado - totalPago

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
    .filter(p => !p.data_pagamento)
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
    .filter(p => !p.data_pagamento && p.data_vencimento && p.data_vencimento < hojeStr)
    .sort((a, b) => (a.data_vencimento ?? '').localeCompare(b.data_vencimento ?? ''))
    .slice(0, 5)
    .map(p => ({ item: p.item, valor: p.valor_previsto, vencimento: p.data_vencimento! }))

  const itensVencendo7d = planAtual
    .filter(p => !p.data_pagamento && p.data_vencimento && p.data_vencimento >= hojeStr && p.data_vencimento <= em7diasStr)
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

/**
 * Compact JSON payload for the dashboard insights API.
 * Uses short keys and dense arrays to minimise token cost while preserving
 * all signal the model needs. ~100 tokens vs ~600 for formatInsightsAsText.
 *
 * Schema (for documentation):
 *   mes/ant       – month labels
 *   gasto/prev    – total spending current/previous month
 *   varPct        – % change
 *   M/J           – Matheus / Jeniffer spending
 *   cats          – top categories: [name, R$, share%, varPct?]
 *   maiores       – top purchases: [description, R$, category]
 *   parc          – installments: [count, total] or null
 *   assins        – subscriptions: [count, monthly total] or null
 *   orc           – budget: [planned, paid, open] or null
 *   invRec        – recent investment contributions total or null
 *   media6m       – 6-month spending average
 *   tend          – trend string
 */
// ─── Rule-based fallback insights (no AI required) ───────────────────────────

import type { InsightItem } from '@/lib/insightsTypes'
import { formatBRL } from '@/lib/format'

const signPct2 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

/**
 * Generates up to 4 structured insights (titulo + detalhe + recomendacao)
 * from pre-computed metrics without calling any external AI API.
 */
export function generateFallbackInsights(ins: FinancialInsightsContext): InsightItem[] {
  const items: InsightItem[] = []

  // 1 — Compras no cartão vs histórico de cartão (alinha com o que "Compras" exibe)
  //     Não inclui despesas fixas do planejamento para evitar confusão de valores.
  if (ins.totalGastos > 0) {
    const vsH = ins.mediaCartaoHistorica > 0
      ? ((ins.totalGastos - ins.mediaCartaoHistorica) / ins.mediaCartaoHistorica) * 100
      : ins.totalCartaoAnterior > 0
      ? ((ins.totalGastos - ins.totalCartaoAnterior) / ins.totalCartaoAnterior) * 100
      : 0
    const alto = vsH > 10
    const baixo = vsH < -5
    items.push({
      icone: alto ? '⚠️' : baixo ? '✅' : '📊',
      titulo: alto
        ? `Compras no cartão ${signPct2(vsH)} acima do padrão`
        : baixo
        ? `Compras no cartão ${signPct2(vsH)} abaixo do padrão`
        : `Compras no cartão dentro do padrão`,
      detalhe: ins.mediaCartaoHistorica > 0
        ? `${formatBRL(ins.totalGastos)} em compras vs média de ${formatBRL(ins.mediaCartaoHistorica)}/mês`
        : `${formatBRL(ins.totalGastos)} em compras vs ${formatBRL(ins.totalCartaoAnterior)} em ${ins.mesAnterior}`,
      recomendacao: alto
        ? `Identifique os gastos extras e avalie o que pode ser cortado`
        : baixo
        ? `Ótimo controle! Considere direcionar a sobra para investimentos`
        : `Continue monitorando para manter o equilíbrio`,
      nivel: alto ? 'alerta' : baixo ? 'positivo' : 'info',
      action: { label: 'Ver compras', route: '/compras' },
    })
  }

  // 2 — Categoria líder
  const top = ins.topCategorias[0]
  if (top) {
    const subindo = top.variacao !== undefined && top.variacao > 15
    items.push({
      icone: subindo ? '📈' : '💳',
      titulo: `${top.categoria} lidera os gastos${subindo ? ` (${signPct2(top.variacao!)} ↑)` : ''}`,
      detalhe: `${formatBRL(top.valor)} — ${top.percentual.toFixed(0)}% do total${top.variacao !== undefined ? ` vs ${formatBRL(top.anterior ?? 0)} no mês anterior` : ''}`,
      recomendacao: subindo
        ? `Revise os gastos em ${top.categoria} — crescimento acima do esperado`
        : top.percentual > 30
        ? `${top.categoria} representa mais de 30% do orçamento — avalie reduzir`
        : `Monitore ${top.categoria} para evitar crescimento`,
      nivel: subindo || top.percentual > 30 ? 'alerta' : 'info',
      action: { label: 'Ver compras', route: '/compras' },
    })
  }

  // 3 — Orçamento ou assinaturas
  if (ins.totalOrcado > 0) {
    const pct = Math.round((ins.totalPago / ins.totalOrcado) * 100)
    const aberto = ins.despesasEmAberto

    if (ins.itensVencidos.length > 0) {
      // Lead with overdue items — highest urgency
      const totalVencido = ins.itensVencidos.reduce((s, i) => s + i.valor, 0)
      const plural = ins.itensVencidos.length > 1
      items.push({
        icone: '🔴',
        titulo: `${ins.itensVencidos.length} despesa${plural ? 's' : ''} vencida${plural ? 's' : ''} sem pagamento`,
        detalhe: `${formatBRL(totalVencido)} em atraso — venceu ${ins.itensVencidos[0].item}${plural ? ` e mais ${ins.itensVencidos.length - 1}` : ''}`,
        recomendacao: `Quite imediatamente: ${ins.itensVencidos[0].item} (${formatBRL(ins.itensVencidos[0].valor)})`,
        nivel: 'alerta',
        action: { label: 'Ver planejamento', route: '/financas?tab=despesas' },
      })
    } else if (ins.itensVencendo7d.length > 0) {
      // Upcoming payments in next 7 days
      const totalVencendo = ins.itensVencendo7d.reduce((s, i) => s + i.valor, 0)
      const plural = ins.itensVencendo7d.length > 1
      const proximos = ins.itensVencendo7d.slice(0, 2).map(i => i.item).join(', ')
      items.push({
        icone: '📅',
        titulo: `${ins.itensVencendo7d.length} despesa${plural ? 's' : ''} vence${plural ? 'm' : ''} esta semana`,
        detalhe: `${formatBRL(totalVencendo)} a pagar em 7 dias — ${proximos}`,
        recomendacao: `Reserve ${formatBRL(totalVencendo)} para quitar ${plural ? 'essas despesas' : 'essa despesa'} no prazo`,
        nivel: 'sugestao',
        action: { label: 'Ver planejamento', route: '/financas?tab=despesas' },
      })
    } else if (aberto === 0) {
      items.push({
        icone: '✅',
        titulo: `Todas as despesas quitadas`,
        detalhe: `Orçamento de ${formatBRL(ins.totalOrcado)} totalmente executado`,
        recomendacao: `Ótima execução orçamentária este mês`,
        nivel: 'positivo',
        action: { label: 'Ver planejamento', route: '/financas?tab=despesas' },
      })
    } else if (pct >= 20 || ins.diaAtual >= 15) {
      // Show % paid only when the number is meaningful (mid-to-late month or significant progress)
      const proximoPendente = ins.itensPlanejamentoEmAberto[0]
      items.push({
        icone: pct >= 60 ? '📋' : '🎯',
        titulo: `${pct}% do orçamento pago em ${ins.mesAtual}`,
        detalhe: `${formatBRL(ins.totalPago)} pago de ${formatBRL(ins.totalOrcado)} — ${formatBRL(aberto)} pendente`,
        recomendacao: proximoPendente
          ? `Priorize: ${proximoPendente.item} (${formatBRL(proximoPendente.valor)})`
          : `Quite as despesas em aberto antes do fechamento do mês`,
        nivel: ins.diaAtual >= 25 && pct < 70 ? 'alerta' : 'sugestao',
        action: { label: 'Ver planejamento', route: '/financas?tab=despesas' },
      })
    } else if (ins.assinaturasAtivas > 0) {
      // Early month with nothing due yet — show subscriptions instead
      items.push({
        icone: '🔄',
        titulo: `${ins.assinaturasAtivas} assinaturas ativas`,
        detalhe: `${formatBRL(ins.totalAssinaturas)}/mês em serviços recorrentes`,
        recomendacao: `Revise assinaturas pouco utilizadas para reduzir custos fixos`,
        nivel: ins.totalAssinaturas > ins.mediaMensalHistorica * 0.15 ? 'alerta' : 'info',
        action: { label: 'Ver assinaturas', route: '/assinaturas' },
      })
    }
  } else if (ins.assinaturasAtivas > 0) {
    items.push({
      icone: '🔄',
      titulo: `${ins.assinaturasAtivas} assinaturas ativas`,
      detalhe: `${formatBRL(ins.totalAssinaturas)}/mês em serviços recorrentes`,
      recomendacao: `Revise assinaturas pouco utilizadas para reduzir custos fixos`,
      nivel: ins.totalAssinaturas > ins.mediaMensalHistorica * 0.15 ? 'alerta' : 'info',
    })
  }

  // 4 — Taxa de poupança (quando renda configurada) ou tendência histórica
  if (ins.rendaMensal !== undefined && ins.sobraLiquida !== undefined) {
    const taxa = ins.taxaPoupanca ?? 0
    items.push({
      icone: taxa >= 20 ? '💰' : taxa < 0 ? '🚨' : '📊',
      titulo: taxa >= 20
        ? `Taxa de poupança: ${taxa.toFixed(0)}% da renda`
        : taxa < 0
        ? `Gastos ${Math.abs(taxa).toFixed(0)}% acima da renda`
        : `${taxa.toFixed(0)}% da renda poupada`,
      detalhe: `Sobra: ${formatBRL(ins.sobraLiquida)} de ${formatBRL(ins.rendaMensal)} de renda mensal`,
      recomendacao: taxa >= 20
        ? `Ótima margem! Considere aportar a sobra em investimentos`
        : taxa < 0
        ? `Revise gastos urgente — você está gastando mais do que ganha`
        : `Reduza gastos variáveis para elevar a taxa de poupança`,
      nivel: taxa >= 20 ? 'positivo' : taxa < 5 ? 'alerta' : 'info',
      action: { label: 'Ver finanças', route: '/financas' },
    })
  } else if (ins.mediaMensalHistorica > 0) {
    const isAlta = ins.tendencia === 'alta'
    const isBaixa = ins.tendencia === 'baixa'
    items.push({
      icone: isAlta ? '📈' : isBaixa ? '📉' : '➡️',
      titulo: isAlta
        ? `Tendência de alta nos gastos`
        : isBaixa
        ? `Tendência de queda nos gastos`
        : `Gastos estáveis nos últimos 6 meses`,
      detalhe: `${signPct2(ins.tendenciaPct)} nos últimos 3 meses — média histórica: ${formatBRL(ins.mediaMensalHistorica)}/mês`,
      recomendacao: isAlta
        ? `Planeje uma revisão de orçamento para o próximo mês`
        : isBaixa
        ? `Aproveite a melhora para aumentar aportes em investimentos`
        : `Mantenha a disciplina financeira atual`,
      nivel: isAlta ? 'alerta' : isBaixa ? 'positivo' : 'info',
    })
  } else if (ins.maioresGastos[0]) {
    const g = ins.maioresGastos[0]
    items.push({
      icone: '💡',
      titulo: `Maior compra do mês`,
      detalhe: `${g.descricao.slice(0, 35)} — ${formatBRL(g.valor)} em ${g.categoria}`,
      recomendacao: `Verifique se esta compra estava prevista no orçamento`,
      nivel: 'info',
      action: { label: 'Ver compras', route: '/compras' },
    })
  }

  return items.slice(0, 4)
}

export function serializeInsightsCompact(ins: FinancialInsightsContext): string {
  const r2 = (n: number) => Math.round(n * 100) / 100

  const cats = ins.topCategorias.slice(0, 5).map(c => {
    const row: [string, number, number, number?] = [
      c.categoria, r2(c.valor), Math.round(c.percentual),
    ]
    if (c.variacao !== undefined) row.push(Math.round(c.variacao * 10) / 10)
    return row
  })

  const maiores = ins.maioresGastos.slice(0, 3).map(g =>
    [g.descricao.slice(0, 30), r2(g.valor), g.categoria] as [string, number, string]
  )

  const invTotal = ins.aportesRecentes.reduce((s, a) => s + a.valor, 0)

  const totalMesCompact = ins.totalGastos + ins.totalOrcado
  const payload: Record<string, unknown> = {
    mes: ins.mesAtual,
    ant: ins.mesAnterior,
    dia: ins.diaAtual,
    // totalMes = faturas + fixas (matches "Gastos" shown on dashboard)
    totalMes: r2(totalMesCompact),
    gasto: r2(ins.totalGastos),   // card fatura only
    prev: r2(ins.totalGastosAnterior),
    varPct: Math.round(ins.variacaoGastos * 10) / 10,
    M: r2(ins.gastoMatheus),
    J: r2(ins.gastoJeniffer),
    cats,
    maiores,
  }

  if (ins.comprasParceladas.count > 0)
    payload.parc = [ins.comprasParceladas.count, r2(ins.comprasParceladas.totalValor)]

  if (ins.assinaturasAtivas > 0)
    payload.assins = [ins.assinaturasAtivas, r2(ins.totalAssinaturas)]

  if (ins.totalOrcado > 0)
    payload.orc = [r2(ins.totalOrcado), r2(ins.totalPago), r2(ins.despesasEmAberto)]

  if (ins.itensVencidos.length > 0)
    payload.vencidos = ins.itensVencidos.slice(0, 3).map(i => [i.item.slice(0, 25), r2(i.valor), i.vencimento])

  if (ins.itensVencendo7d.length > 0)
    payload.venc7d = ins.itensVencendo7d.slice(0, 3).map(i => [i.item.slice(0, 25), r2(i.valor), i.vencimento])

  if (invTotal > 0)
    payload.invRec = r2(invTotal)

  if (ins.mediaCartaoHistorica > 0)
    payload.mediaCartao = r2(ins.mediaCartaoHistorica)

  if (ins.mediaMensalHistorica > 0) {
    payload.media6m = r2(ins.mediaMensalHistorica)
    payload.tend = ins.tendencia === 'estavel'
      ? 'estavel'
      : `${ins.tendencia} ${ins.tendenciaPct > 0 ? '+' : ''}${Math.round(ins.tendenciaPct * 10) / 10}%`
  }

  if (ins.rendaMensal) {
    payload.renda = r2(ins.rendaMensal)
    if (ins.sobraLiquida !== undefined) payload.sobra = r2(ins.sobraLiquida)
    if (ins.taxaPoupanca !== undefined) payload.poupPct = Math.round(ins.taxaPoupanca * 10) / 10
  }

  const assinsCats = Object.entries(ins.assinaturasPorCategoria)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (assinsCats.length > 0 && ins.assinaturasAtivas > 0)
    payload.assinsCats = assinsCats.map(([cat, val]) => [cat, r2(val)])

  return JSON.stringify(payload)
}

export function formatInsightsAsText(ins: FinancialInsightsContext): string {
  const fmtR = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
  const signPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  const tendStr =
    ins.tendencia === 'estavel'
      ? 'estável'
      : ins.tendencia === 'alta'
      ? `↑ em alta (${signPct(ins.tendenciaPct)} últimos 3m vs anteriores)`
      : `↓ em queda (${signPct(ins.tendenciaPct)} últimos 3m vs anteriores)`

  let out = `\nMÉTRICAS FINANCEIRAS — ${ins.mesAtual}\n`
  out += `${'─'.repeat(50)}\n`

  // Total = faturas (cartão) + despesas fixas planejadas — matches "Gastos" in the dashboard
  const totalMes = ins.totalGastos + ins.totalOrcado
  if (ins.totalOrcado > 0) {
    out += `TOTAL DO MÊS: ${fmtR(totalMes)} (faturas cartão ${fmtR(ins.totalGastos)} + fixas ${fmtR(ins.totalOrcado)})\n`
  }

  out += `\nFATURAS CARTÃO (${ins.mesAtual}): ${fmtR(ins.totalGastos)}`
  if (ins.totalGastosAnterior > 0) {
    out += ` (${signPct(ins.variacaoGastos)} vs ${ins.mesAnterior}: ${fmtR(ins.totalGastosAnterior)})`
  }
  out += `\n`
  out += `  Por responsável: Matheus ${fmtR(ins.gastoMatheus)} | Jeniffer ${fmtR(ins.gastoJeniffer)}\n`

  if (Object.keys(ins.gastoPorCartao).length > 1) {
    out += `  Por cartão: ${Object.entries(ins.gastoPorCartao).map(([c, v]) => `${c} ${fmtR(v)}`).join(' | ')}\n`
  }

  out += `\nTOP CATEGORIAS:\n`
  for (const cat of ins.topCategorias) {
    const varStr = cat.variacao !== undefined ? ` (${signPct(cat.variacao)} vs ant)` : ''
    out += `  ${cat.categoria}: ${fmtR(cat.valor)} (${cat.percentual.toFixed(0)}%${varStr})\n`
  }

  out += `\nMAIORES COMPRAS:\n`
  for (const g of ins.maioresGastos) {
    const cartaoLabel = Object.keys(ins.gastoPorCartao).length > 1 ? ` {${g.cartao}}` : ''
    out += `  ${g.responsavel[0]} ${g.descricao}${cartaoLabel} — ${fmtR(g.valor)} [${g.categoria}]\n`
  }

  if (ins.comprasParceladas.count > 0) {
    out += `\nPARCELAMENTOS ATIVOS: ${ins.comprasParceladas.count} parcelas (${fmtR(ins.comprasParceladas.totalValor)} este mês)\n`
  }

  if (ins.assinaturasAtivas > 0) {
    out += `\nASSINATURAS: ${fmtR(ins.totalAssinaturas)}/mês em ${ins.assinaturasAtivas} serviços ativos\n`
    const cats = Object.entries(ins.assinaturasPorCategoria).sort((a, b) => b[1] - a[1])
    if (cats.length > 0) {
      out += `  Por categoria: ${cats.map(([c, v]) => `${c} ${fmtR(v)}`).join(' | ')}\n`
    }
  }

  if (ins.totalOrcado > 0) {
    const pctPago = ins.totalOrcado > 0 ? (ins.totalPago / ins.totalOrcado) * 100 : 0
    out += `\nPLANEJAMENTO (${ins.mesAtual}): orçado ${fmtR(ins.totalOrcado)} | pago ${fmtR(ins.totalPago)} (${pctPago.toFixed(0)}%)`
    if (ins.despesasEmAberto > 0) out += ` | em aberto ${fmtR(ins.despesasEmAberto)}`
    out += `\n`
    if (ins.itensPlanejamentoEmAberto.length > 0) {
      out += `  Pendentes: ${ins.itensPlanejamentoEmAberto.map(i => `${i.item} ${fmtR(i.valor)}`).join(', ')}\n`
    }
  }

  if (ins.totalAportesHistorico > 0) {
    out += `\nINVESTIMENTOS: ${fmtR(ins.totalAportesHistorico)} total histórico aportado\n`
    if (ins.aportesRecentes.length > 0) {
      out += `  Recentes: ${ins.aportesRecentes.map(a => `${a.descricao} ${fmtR(a.valor)}`).join(', ')}\n`
    }
  }

  if (ins.mediaMensalHistorica > 0) {
    out += `\nMÉDIA HISTÓRICA: ${fmtR(ins.mediaMensalHistorica)}/mês (últimos 6 meses)\n`
    out += `TENDÊNCIA: ${tendStr}\n`
  }

  return out
}
