'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from 'chart.js'
import { format, startOfMonth, addMonths, eachDayOfInterval } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Activity, AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import type { TooltipItem, Plugin } from 'chart.js'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const COLOR = { r: 124, g: 58, b: 237 } // violet-600

function rgb(a = 1) {
  return `rgba(${COLOR.r},${COLOR.g},${COLOR.b},${a})`
}

interface GradientChart {
  ctx: CanvasRenderingContext2D
  chartArea?: { top: number; bottom: number }
  data: { datasets: Array<{ backgroundColor?: string | CanvasGradient | null }> }
}

const gradientPlugin: Plugin<'line'> = {
  id: 'gastosDiariosGradient',
  beforeDatasetsDraw(chart: unknown) {
    const c = chart as GradientChart
    if (!c.chartArea) return
    const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom)
    g.addColorStop(0,    rgb(0.22))
    g.addColorStop(0.55, rgb(0.07))
    g.addColorStop(1,    rgb(0))
    if (c.data.datasets[0]) c.data.datasets[0].backgroundColor = g
  },
}

type FiltroResponsavel = 'todos' | 'Matheus' | 'Jeniffer'
type FiltroCartao      = 'todos' | 'nubank'  | 'cartao1' | 'cartao2'

interface TransacaoRaw {
  valor: number
  data_compra: string | null
  responsavel: string
  cartao: string
}

interface DatePoint {
  isoDate: string   // YYYY-MM-DD
  label: string     // "28/abr"
  fullLabel: string // "28 de abril de 2026"
  total: number
  count: number
}

interface Props {
  mesAtual: Date
}

const CARTAO_LABELS: Record<FiltroCartao, string> = {
  todos: 'Todos',
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

export default function GraficoGastosDiarios({ mesAtual }: Props) {
  const [rawData, setRawData]           = useState<TransacaoRaw[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [filtroResp, setFiltroResp]     = useState<FiltroResponsavel>('todos')
  const [filtroCartao, setFiltroCartao] = useState<FiltroCartao>('todos')
  const { isDark, isDarkRef }           = useIsDark()

  const plugins = useMemo(
    () => [gradientPlugin, makeCrosshairPlugin('gastosDiariosCrosshair', isDarkRef, 0.12, 0.08)] as Plugin<'line'>[],
    [isDarkRef],
  )

  // projeto_fatura for the selected month: first day of next month (same as dashboard)
  const mesRefFatura = useMemo(
    () => format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd'),
    [mesAtual],
  )

  const carregar = useCallback(async () => {
    setError(null)
    try {
      // Query by billing period (projeto_fatura), consistent with the rest of the dashboard.
      // This returns all transactions that appear on the bill for the selected month,
      // regardless of which calendar day the purchase was made.
      const { data, error: err } = await supabase
        .from('transacoes_nubank')
        .select('valor, data_compra, responsavel, cartao')
        .eq('projeto_fatura', mesRefFatura)

      if (err) {
        if (err.message?.includes('data_compra')) {
          // Legacy schema: date column is named 'data'
          const { data: legacyData, error: legacyErr } = await supabase
            .from('transacoes_nubank')
            .select('valor, data, responsavel, cartao')
            .eq('projeto_fatura', mesRefFatura)
          if (legacyErr) throw legacyErr
          const normalized: TransacaoRaw[] = (legacyData ?? []).map(
            (r: { valor: number; data: string | null; responsavel: string; cartao: string }) => ({
              valor: r.valor,
              data_compra: r.data,
              responsavel: r.responsavel,
              cartao: r.cartao,
            }),
          )
          setRawData(normalized)
        } else {
          throw err
        }
      } else {
        setRawData(data ?? [])
      }
    } catch {
      setError('Não foi possível carregar os gastos diários.')
    } finally {
      setLoading(false)
    }
  }, [mesRefFatura])

  useEffect(() => {
    setLoading(true)
    setRawData([])
    carregar()
  }, [carregar])

  // Build date-indexed series from the billing-period transactions.
  // The date range is determined dynamically from the actual data_compra values,
  // so it naturally covers the real billing cycle (e.g., 28/abr → 3/mai).
  const series = useMemo((): DatePoint[] => {
    // Aggregate by date after applying filters
    const byDate = new Map<string, { total: number; count: number }>()
    for (const tx of rawData) {
      if (!tx.data_compra) continue
      if (filtroResp !== 'todos' && tx.responsavel !== filtroResp) continue
      if (filtroCartao !== 'todos' && tx.cartao !== filtroCartao) continue
      const entry = byDate.get(tx.data_compra) ?? { total: 0, count: 0 }
      entry.total += tx.valor
      entry.count++
      byDate.set(tx.data_compra, entry)
    }

    if (byDate.size === 0) return []

    const sortedDates = Array.from(byDate.keys()).sort()
    const start = new Date(sortedDates[0] + 'T12:00:00')
    const end   = new Date(sortedDates[sortedDates.length - 1] + 'T12:00:00')

    return eachDayOfInterval({ start, end }).map(d => {
      const iso  = format(d, 'yyyy-MM-dd')
      const data = byDate.get(iso) ?? { total: 0, count: 0 }
      return {
        isoDate:   iso,
        label:     format(d, "d/MMM",                       { locale: ptBR }),
        fullLabel: format(d, "d 'de' MMMM 'de' yyyy",       { locale: ptBR }),
        total: data.total,
        count: data.count,
      }
    })
  }, [rawData, filtroResp, filtroCartao])

  const hasData  = series.some(p => p.total > 0)
  const totalFat = series.reduce((s, p) => s + p.total, 0)
  const peakDay  = series.reduce((m, p) => (p.total > m.total ? p : m), series[0] ?? { total: 0, label: '', fullLabel: '', isoDate: '', count: 0 })

  const chartData = useMemo(() => {
    if (!hasData) return null
    const pBorder = isDark ? '#0f172a' : '#ffffff'
    return {
      labels: series.map(p => p.label),
      datasets: [{
        label: 'Gastos do dia',
        data: series.map(p => p.total),
        borderColor: rgb(1),
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.42,
        fill: true,
        pointRadius: series.map(p => (p.total > 0 ? 3 : 0)),
        pointHoverRadius: 8,
        pointHitRadius: 22,
        pointBackgroundColor: rgb(1),
        pointBorderColor: pBorder,
        pointBorderWidth: 2,
        pointHoverBorderWidth: 2,
      }],
    }
  }, [series, hasData, isDark])

  const options = useMemo(() => {
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
    const tbg  = isDark ? 'rgba(15,23,42,0.97)'   : 'rgba(15,23,42,0.93)'
    const n    = series.length

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: { duration: 600, easing: 'easeInOutCubic' as const },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tbg,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          padding: { top: 10, right: 16, bottom: 10, left: 16 },
          cornerRadius: 12,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => {
              return series[items[0]?.dataIndex ?? 0]?.fullLabel ?? ''
            },
            label: (ctx: TooltipItem<'line'>) => `  ${formatBRL(ctx.parsed.y ?? 0)}`,
            afterLabel: (ctx: TooltipItem<'line'>) => {
              const cnt = series[ctx.dataIndex]?.count ?? 0
              return cnt > 0 ? `  ${cnt} lançamento${cnt !== 1 ? 's' : ''}` : ''
            },
            labelColor: () => ({
              borderColor: rgb(0.9),
              backgroundColor: rgb(0.85),
              borderWidth: 2,
              borderRadius: 3,
            }),
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v: number | string) => {
              const num = Number(v)
              if (num === 0) return 'R$0'
              if (num >= 1000) return `R$${(num / 1000).toFixed(0)}k`
              return `R$${num.toFixed(0)}`
            },
            font: { size: 10 },
            maxTicksLimit: 4,
            color: txt,
          },
          grid: { color: grid, lineWidth: 1 },
          border: { display: false },
        },
        x: {
          ticks: {
            font: { size: 10 },
            color: txt,
            padding: 4,
            maxRotation: 0,
            // Show first, last, and every ~5th label to avoid crowding
            callback: (_v: number | string, index: number) => {
              if (index === 0 || index === n - 1 || index % 5 === 0) {
                return series[index]?.label ?? ''
              }
              return ''
            },
          },
          grid: { display: false },
          border: { display: false },
        },
      },
    }
  }, [isDark, series])

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7" />
        <span className="text-sm">{error}</span>
        <button
          onClick={() => { setLoading(true); carregar() }}
          className="text-xs text-violet-500 underline"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {(['todos', 'Matheus', 'Jeniffer'] as FiltroResponsavel[]).map(r => (
          <button
            key={r}
            onClick={() => setFiltroResp(r)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              filtroResp === r
                ? 'bg-violet-100 text-violet-700 border border-violet-200'
                : 'bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200'
            }`}
          >
            {r === 'todos' ? 'Todos' : r}
          </button>
        ))}
        <span className="w-px h-4 bg-gray-200 self-center mx-0.5" />
        {(['todos', 'nubank', 'cartao1', 'cartao2'] as FiltroCartao[]).map(c => (
          <button
            key={c}
            onClick={() => setFiltroCartao(c)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              filtroCartao === c
                ? 'bg-violet-100 text-violet-700 border border-violet-200'
                : 'bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200'
            }`}
          >
            {CARTAO_LABELS[c]}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400">
          <Activity className="w-8 h-8 opacity-40" />
          <p className="text-sm font-medium text-gray-500">Sem lançamentos no período</p>
          <p className="text-xs opacity-60">
            {filtroResp !== 'todos' || filtroCartao !== 'todos'
              ? 'Nenhum gasto encontrado com os filtros atuais'
              : 'Os gastos por dia aparecerão aqui conforme forem registrados'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">Total da fatura</span>
              <span className="text-sm font-bold text-violet-700 num">{formatBRL(totalFat)}</span>
            </div>
            {peakDay.total > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>Pico</span>
                <span className="font-semibold text-gray-600 num">{formatBRL(peakDay.total)}</span>
                <span className="text-gray-400">{peakDay.label}</span>
              </div>
            )}
          </div>

          <div className="h-44 md:h-52 lg:h-56">
            {chartData && <Line data={chartData} options={options} plugins={plugins} />}
          </div>
        </>
      )}
    </div>
  )
}
