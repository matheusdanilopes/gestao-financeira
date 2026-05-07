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
  const [yoyLoading, setYoyLoading] = useState(false)

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
    setYoyLoading(true)
    supabase
      .rpc('rpc_analytics_yoy', { p_year_a: yearA, p_year_b: yearB })
      .then(({ data }) => {
        setYoyRows((data ?? []) as AnalyticsYoYRow[])
        setYoyLoading(false)
      })
  }, [filters.dateFrom, filters.dateTo])

  const loading = status === 'loading' || yoyLoading

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
