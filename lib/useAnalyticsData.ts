'use client'

import { useState, useEffect, useMemo } from 'react'
import type { ChartData } from 'chart.js'
import { format, parseISO, subMonths, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalSync } from '@/lib/useGlobalSync'

export interface AnalyticsMensalRow {
  mes: string
  categoria: string
  responsavel: string
  total_gasto: number
  contagem: number
}

export interface AnalyticsYoYRow {
  mes_num: number
  ano: number
  total_gasto: number
}

export interface AnalyticsFilters {
  dateFrom: string
  dateTo: string
  categorias: string[]
  responsavel: '' | 'Matheus' | 'Jeniffer'
}

interface RevenueRow { data: string; valor: number }
interface InvestmentRow { data_atualizacao: string; valor_atual: number; tipo_ativo: string }
interface BudgetRow { categoria_id: string; valor_previsto: number; mes_referencia: string }

const CAT_COLORS = [
  '#8b5cf6', '#3b82f6', '#ec4899', '#10b981',
  '#f59e0b', '#ef4444', '#06b6d4', '#6366f1',
  '#84cc16', '#f97316', '#14b8a6', '#a855f7',
]

const MES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

export function useAnalyticsData(filters: AnalyticsFilters) {
  const [rows, setRows] = useState<AnalyticsMensalRow[]>([])
  const [yoyRows, setYoyRows] = useState<AnalyticsYoYRow[]>([])
  const [revenues, setRevenues] = useState<RevenueRow[]>([])
  const [investments, setInvestments] = useState<InvestmentRow[]>([])
  const [budgets, setBudgets] = useState<BudgetRow[]>([])

  const { status, refetch } = useGlobalSync({
    cacheKey: `analytics:${filters.dateFrom}:${filters.dateTo}:${filters.categorias.join(',')}:${filters.responsavel}`,
    tables: ['transacoes_nubank'],
    fetcher: async () => {
      let q = supabase
        .from('v_analytics_mensal')
        .select('mes,categoria,responsavel,total_gasto,contagem')
        .gte('mes', filters.dateFrom)
        .lte('mes', filters.dateTo)
      if (filters.categorias.length > 0) q = q.in('categoria', filters.categorias)
      if (filters.responsavel) q = q.eq('responsavel', filters.responsavel)
      const { data } = await q
      return data ?? []
    },
    onData: (data) => setRows(data as AnalyticsMensalRow[]),
  })

  // YoY fetch: triggered when year range changes
  useEffect(() => {
    const yearA = new Date(filters.dateFrom).getFullYear() - 1
    const yearB = new Date(filters.dateTo).getFullYear()
    supabase
      .rpc('rpc_analytics_yoy', { p_year_a: yearA, p_year_b: yearB })
      .then(({ data }) => {
        setYoyRows((data ?? []) as AnalyticsYoYRow[])
      })
  }, [filters.dateFrom, filters.dateTo])

  useEffect(() => {
    supabase.from('revenues').select('data,valor').gte('data', filters.dateFrom).lte('data', filters.dateTo)
      .then(({ data }) => setRevenues((data ?? []) as RevenueRow[]))
    supabase.from('investments').select('data_atualizacao,valor_atual,tipo_ativo').gte('data_atualizacao', filters.dateFrom).lte('data_atualizacao', filters.dateTo)
      .then(({ data }) => setInvestments((data ?? []) as InvestmentRow[]))
    supabase.from('budgets').select('categoria_id,valor_previsto,mes_referencia').eq('mes_referencia', filters.dateTo)
      .then(({ data }) => setBudgets((data ?? []) as BudgetRow[]))
  }, [filters.dateFrom, filters.dateTo])

  const loading = status === 'loading'

  // ── Chart memos ───────────────────────────────────────────────────────────

  const trendChartData = useMemo<ChartData<'line'>>(() => {
    const byMes = new Map<string, number>()
    for (const r of rows) {
      byMes.set(r.mes, (byMes.get(r.mes) ?? 0) + r.total_gasto)
    }
    const sorted = [...byMes.entries()].sort(([a], [b]) => a.localeCompare(b))
    return {
      labels: sorted.map(([m]) => format(parseISO(m), 'MMM/yy', { locale: ptBR })),
      datasets: [
        {
          label: 'Gastos mensais',
          data: sorted.map(([, v]) => v),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#6366f1',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
      ],
    }
  }, [rows])

  const categoryDonutData = useMemo<ChartData<'doughnut'>>(() => {
    const byCat = new Map<string, number>()
    for (const r of rows) {
      byCat.set(r.categoria, (byCat.get(r.categoria) ?? 0) + r.total_gasto)
    }
    const sorted = [...byCat.entries()].sort(([, a], [, b]) => b - a)
    return {
      labels: sorted.map(([c]) => c),
      datasets: [
        {
          data: sorted.map(([, v]) => v),
          backgroundColor: sorted.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]),
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    }
  }, [rows])

  const personBarData = useMemo<ChartData<'bar'>>(() => {
    const meses = [...new Set(rows.map((r) => r.mes))].sort()
    const mathDat = meses.map((m) =>
      rows.filter((r) => r.mes === m && r.responsavel === 'Matheus').reduce((s, r) => s + r.total_gasto, 0)
    )
    const jeniDat = meses.map((m) =>
      rows.filter((r) => r.mes === m && r.responsavel === 'Jeniffer').reduce((s, r) => s + r.total_gasto, 0)
    )
    return {
      labels: meses.map((m) => format(parseISO(m), 'MMM/yy', { locale: ptBR })),
      datasets: [
        { label: 'Matheus', data: mathDat, backgroundColor: '#1d4ed8', borderRadius: 4, borderSkipped: false },
        { label: 'Jeniffer', data: jeniDat, backgroundColor: '#be185d', borderRadius: 4, borderSkipped: false },
      ],
    }
  }, [rows])

  const yoyBarData = useMemo<ChartData<'bar'>>(() => {
    const years = [...new Set(yoyRows.map((r) => r.ano))].sort()
    const [yearA, yearB] = years.length >= 2 ? [years[0], years[years.length - 1]] : [years[0], years[0]]
    const getTotal = (ano: number, mes: number) =>
      yoyRows.find((r) => r.ano === ano && r.mes_num === mes)?.total_gasto ?? 0
    return {
      labels: MES_PT,
      datasets: [
        {
          label: String(yearA ?? ''),
          data: Array.from({ length: 12 }, (_, i) => getTotal(yearA, i + 1)),
          backgroundColor: 'rgba(99,102,241,0.4)',
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: String(yearB ?? ''),
          data: Array.from({ length: 12 }, (_, i) => getTotal(yearB, i + 1)),
          backgroundColor: 'rgba(99,102,241,0.85)',
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    }
  }, [yoyRows])

  const kpis = useMemo(() => {
    const totalGasto = rows.reduce((s, r) => s + r.total_gasto, 0)
    const totalMeses = new Set(rows.map((r) => r.mes)).size || 1
    return { burnRate: totalGasto / totalMeses, totalGasto, totalMeses }
  }, [rows])

  const cashFlowData = useMemo<ChartData<'bar'>>(() => {
    const byMonth = new Map<string, { receita: number; despesa: number }>()
    revenues.forEach((r) => {
      const m = r.data.slice(0, 7)
      const curr = byMonth.get(m) ?? { receita: 0, despesa: 0 }
      curr.receita += r.valor
      byMonth.set(m, curr)
    })
    rows.forEach((r) => {
      const m = r.mes.slice(0, 7)
      const curr = byMonth.get(m) ?? { receita: 0, despesa: 0 }
      curr.despesa += r.total_gasto
      byMonth.set(m, curr)
    })
    const months = [...byMonth.keys()].sort()
    return { labels: months, datasets: [
      { label: 'Receita', data: months.map((m) => byMonth.get(m)?.receita ?? 0), backgroundColor: '#22c55e' },
      { label: 'Despesa', data: months.map((m) => byMonth.get(m)?.despesa ?? 0), backgroundColor: '#ef4444' },
    ] }
  }, [revenues, rows])

  const investmentAllocationData = useMemo<ChartData<'doughnut'>>(() => {
    const byType = new Map<string, number>()
    investments.forEach((i) => byType.set(i.tipo_ativo, (byType.get(i.tipo_ativo) ?? 0) + i.valor_atual))
    const labels = [...byType.keys()]
    return { labels, datasets: [{ data: labels.map((l) => byType.get(l) ?? 0), backgroundColor: CAT_COLORS.slice(0, labels.length) }] }
  }, [investments])

  const netWorthTrendData = useMemo<ChartData<'line'>>(() => {
    const byMonthInvest = new Map<string, number>()
    const byMonthRevenue = new Map<string, number>()
    const byMonthExpense = new Map<string, number>()

    investments.forEach((i) => {
      const m = i.data_atualizacao.slice(0, 7)
      byMonthInvest.set(m, (byMonthInvest.get(m) ?? 0) + i.valor_atual)
    })
    revenues.forEach((r) => {
      const m = r.data.slice(0, 7)
      byMonthRevenue.set(m, (byMonthRevenue.get(m) ?? 0) + r.valor)
    })
    rows.forEach((r) => {
      const m = r.mes.slice(0, 7)
      byMonthExpense.set(m, (byMonthExpense.get(m) ?? 0) + r.total_gasto)
    })

    const months = [...new Set([...byMonthInvest.keys(), ...byMonthRevenue.keys(), ...byMonthExpense.keys()])].sort().slice(-12)
    const patrimonio = months.reduce<number[]>((acc, m) => {
      const saldoAnterior = acc.length > 0 ? acc[acc.length - 1] - (byMonthInvest.get(months[acc.length - 1]) ?? 0) : 0
      const saldoAtual = saldoAnterior + (byMonthRevenue.get(m) ?? 0) - (byMonthExpense.get(m) ?? 0)
      acc.push(saldoAtual + (byMonthInvest.get(m) ?? 0))
      return acc
    }, [])

    return { labels: months, datasets: [{ label: 'Patrimônio Líquido', data: patrimonio, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', fill: true }] }
  }, [investments, revenues, rows])

  const budgetProgress = useMemo(() => {
    const selectedMonth = filters.dateTo.slice(0, 7)
    const spentByCat = new Map<string, number>()
    rows.filter((r) => r.mes.slice(0, 7) === selectedMonth).forEach((r) => spentByCat.set(r.categoria, (spentByCat.get(r.categoria) ?? 0) + r.total_gasto))
    return budgets.map((b) => {
      const spent = spentByCat.get(b.categoria_id) ?? 0
      const pct = b.valor_previsto > 0 ? (spent / b.valor_previsto) * 100 : 0
      return { categoria: b.categoria_id, previsto: b.valor_previsto, gasto: spent, pct, variancia: b.valor_previsto - spent }
    })
  }, [budgets, rows, filters.dateTo])

  const financeMetrics = useMemo(() => {
    const currentMonth = filters.dateTo.slice(0, 7)
    const receitaMes = revenues.filter((r) => r.data.slice(0, 7) === currentMonth).reduce((s, r) => s + r.valor, 0)
    const despesaMes = rows.filter((r) => r.mes.slice(0, 7) === currentMonth).reduce((s, r) => s + r.total_gasto, 0)
    const taxaPoupanca = receitaMes > 0 ? ((receitaMes - despesaMes) / receitaMes) * 100 : 0
    const patrimonioAtual = investments.filter((i) => i.data_atualizacao.slice(0, 7) === currentMonth).reduce((s, i) => s + i.valor_atual, 0)
    const runwayMeses = despesaMes > 0 ? patrimonioAtual / despesaMes : 0
    return { receitaMes, despesaMes, taxaPoupanca, patrimonioAtual, runwayMeses }
  }, [revenues, rows, investments, filters.dateTo])

  return {
    rows,
    yoyRows,
    loading,
    refetch,
    trendChartData,
    categoryDonutData,
    personBarData,
    yoyBarData,
    kpis,
    cashFlowData,
    investmentAllocationData,
    netWorthTrendData,
    budgetProgress,
    financeMetrics,
    fmtBRL,
    CAT_COLORS,
  }
}

export { fmtBRL, CAT_COLORS, MES_PT }

// Re-export default date range helpers
export function defaultDateFrom() {
  return format(startOfMonth(subMonths(new Date(), 11)), 'yyyy-MM-dd')
}
export function defaultDateTo() {
  return format(startOfMonth(new Date()), 'yyyy-MM-dd')
}
