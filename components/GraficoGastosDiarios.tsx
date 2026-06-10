'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Activity, AlertCircle, ChevronDown } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import type { Plugin } from 'chart.js'
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
  data: { datasets: Array<{ backgroundColor?: string | CanvasGradient | null; fill?: unknown }> }
}

interface WeekendChart {
  ctx: CanvasRenderingContext2D
  chartArea?: { top: number; height: number }
  scales: { x: { getPixelForValue: (v: number) => number } }
}

function makeWeekendBandPlugin(
  seriesRef: { current: DatePoint[] },
  isDarkRef: { current: boolean },
): Plugin<'line'> {
  return {
    id: 'gastosDiariosWeekend',
    beforeDatasetsDraw(chart: unknown) {
      const c = chart as WeekendChart
      if (!c.chartArea) return
      const series = seriesRef.current
      if (series.length < 2) return
      const step = c.scales.x.getPixelForValue(1) - c.scales.x.getPixelForValue(0)
      const alpha = isDarkRef.current ? 0.10 : 0.06
      c.ctx.save()
      series.forEach((pt, i) => {
        const day = new Date(pt.isoDate + 'T12:00:00').getDay()
        if (day !== 0 && day !== 6) return
        const x = c.scales.x.getPixelForValue(i)
        c.ctx.fillStyle = `rgba(124, 58, 237, ${alpha})`
        c.ctx.fillRect(x - step / 2, c.chartArea!.top, step, c.chartArea!.height)
      })
      c.ctx.restore()
    },
  }
}

const gradientPlugin: Plugin<'line'> = {
  id: 'gastosDiariosGradient',
  beforeDatasetsDraw(chart: unknown) {
    const c = chart as GradientChart
    if (!c.chartArea) return
    const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom)
    g.addColorStop(0,    rgb(0.38))
    g.addColorStop(0.55, rgb(0.12))
    g.addColorStop(1,    rgb(0))
    const ds = c.data.datasets.find(d => d.fill === true) ?? c.data.datasets[0]
    if (ds) ds.backgroundColor = g
  },
}

// Module-level constant — not recreated on every render
const SELECT_CLS =
  'w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 pr-8 text-xs text-gray-700 ' +
  'font-medium appearance-none cursor-pointer focus:outline-none focus:ring-1 ' +
  'focus:ring-violet-400 focus:border-violet-400 hover:border-gray-300 transition-colors'

type FiltroResponsavel = 'todos' | 'Matheus' | 'Jeniffer'
type FiltroCartao      = 'todos' | 'nubank'  | 'cartao1' | 'cartao2'
type Visao             = 'valor' | 'acumulado'

interface TransacaoRaw {
  valor: number
  data_compra: string | null
  responsavel: string
  cartao: string
  descricao?: string | null
  parcela_atual?: number | string | null
  total_parcelas?: number | string | null
}

function ehParcelaNaoInicial(tx: TransacaoRaw): boolean {
  if (tx.parcela_atual && tx.total_parcelas) {
    const atual = Number(tx.parcela_atual)
    const total = Number(tx.total_parcelas)
    if (atual >= 1 && total >= atual) return atual > 1
  }
  const desc = String(tx.descricao || '')
  const matchParcela = desc.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (matchParcela) return Number(matchParcela[1]) > 1
  const matchSlash = desc.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (matchSlash && Number(matchSlash[2]) >= 2) return Number(matchSlash[1]) > 1
  return false
}

interface DatePoint {
  isoDate: string
  label: string     // "28/abr"
  fullLabel: string // "28 de abril de 2026"
  total: number
  count: number
}

interface HoveredPoint {
  fullLabel: string
  total: number
  count: number
}

interface BurndownHover {
  fullLabel: string
  real: number
  esperado: number
}

export type { Visao }

interface Props {
  mesAtual: Date
  cartao1Nome?: string
  cartao2Nome?: string
  visao: Visao
  onVisaoChange: (v: Visao) => void
}

export default function GraficoGastosDiarios({
  mesAtual,
  cartao1Nome = 'Cartão 1',
  cartao2Nome = 'Cartão 2',
  visao,
  onVisaoChange,
}: Props) {
  const [rawData, setRawData]           = useState<TransacaoRaw[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [filtroResp, setFiltroResp]     = useState<FiltroResponsavel>('todos')
  const [filtroCartao, setFiltroCartao] = useState<FiltroCartao>('todos')
  const { isDark, isDarkRef }           = useIsDark()

  // Kept in a ref so tooltip callbacks always read current series without
  // adding series to the options dependency array (which would re-animate
  // the chart on every filter change).
  const seriesRef = useRef<DatePoint[]>([])
  const [hoveredPoint, setHoveredPoint]     = useState<HoveredPoint | null>(null)
  const [acumuladoHover, setBurndownHover]   = useState<BurndownHover | null>(null)

  // Reset hover state when switching views so stale data doesn't persist
  useEffect(() => {
    setHoveredPoint(null)
    setBurndownHover(null)
  }, [visao])

  const weekendPlugin = useMemo(
    () => makeWeekendBandPlugin(seriesRef, isDarkRef),
    [isDarkRef],
  )

  const plugins = useMemo(
    () => [gradientPlugin, weekendPlugin, makeCrosshairPlugin('gastosDiariosCrosshair', isDarkRef, 0.12, 0.08)] as Plugin<'line'>[],
    [isDarkRef, weekendPlugin],
  )

  const mesRefFatura = useMemo(
    () => format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd'),
    [mesAtual],
  )

  const carregar = useCallback(async () => {
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('transacoes_nubank')
        .select('valor, data_compra, responsavel, cartao, descricao, parcela_atual, total_parcelas')
        .eq('projeto_fatura', mesRefFatura)

      if (err) {
        if (err.message?.includes('data_compra')) {
          // Legacy schema: column named 'data' instead of 'data_compra'
          const { data: legacyData, error: legacyErr } = await supabase
            .from('transacoes_nubank')
            .select('valor, data, responsavel, cartao, descricao, parcela_atual, total_parcelas')
            .eq('projeto_fatura', mesRefFatura)
          if (legacyErr) throw legacyErr
          setRawData(
            (legacyData ?? []).map(
              (r: { valor: number; data: string | null; responsavel: string; cartao: string; descricao?: string | null; parcela_atual?: number | string | null; total_parcelas?: number | string | null }) => ({
                valor: r.valor,
                data_compra: r.data,
                responsavel: r.responsavel,
                cartao: r.cartao,
                descricao: r.descricao,
                parcela_atual: r.parcela_atual,
                total_parcelas: r.total_parcelas,
              }),
            ),
          )
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

  const series = useMemo((): DatePoint[] => {
    const byDate = new Map<string, { total: number; count: number }>()
    for (const tx of rawData) {
      if (!tx.data_compra) continue
      if (filtroResp !== 'todos' && tx.responsavel !== filtroResp) continue
      if (filtroCartao !== 'todos' && tx.cartao !== filtroCartao) continue
      if (ehParcelaNaoInicial(tx)) continue
      const entry = byDate.get(tx.data_compra) ?? { total: 0, count: 0 }
      entry.total += tx.valor
      entry.count++
      byDate.set(tx.data_compra, entry)
    }

    if (byDate.size === 0) return []

    const sorted = Array.from(byDate.keys()).sort()
    const start  = new Date(sorted[0] + 'T12:00:00')
    const end    = new Date(sorted[sorted.length - 1] + 'T12:00:00')

    return eachDayOfInterval({ start, end }).map(d => {
      const iso  = format(d, 'yyyy-MM-dd')
      const data = byDate.get(iso) ?? { total: 0, count: 0 }
      return {
        isoDate:   iso,
        label:     format(d, 'd/MMM',                         { locale: ptBR }),
        fullLabel: format(d, "EEEE, d 'de' MMMM 'de' yyyy",    { locale: ptBR }),
        total: data.total,
        count: data.count,
      }
    })
  }, [rawData, filtroResp, filtroCartao])

  // Keep ref in sync so options callbacks can read it without deps
  useEffect(() => { seriesRef.current = series }, [series])

  const hasData  = series.some(p => p.total > 0)
  const totalFat = series.reduce((s, p) => s + p.total, 0)
  const peakDay  = series.reduce(
    (m, p) => (p.total > m.total ? p : m),
    series[0] ?? { total: 0, label: '', fullLabel: '', isoDate: '', count: 0 },
  )

  const chartData = useMemo(() => {
    if (!hasData) return null
    const pBorder  = isDark ? '#0f172a' : '#ffffff'
    const realDs = {
      label: 'Real',
      data: [] as number[],
      borderColor: rgb(1),
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      cubicInterpolationMode: 'monotone' as const,
      tension: 0.4,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHitRadius: 28,
      pointBackgroundColor: rgb(1),
      pointBorderColor: pBorder,
      pointBorderWidth: 2,
      pointHoverBorderWidth: 2,
    }

    if (visao === 'acumulado') {
      const n = series.length
      let cum = 0
      realDs.data = series.map(p => { cum += p.total; return cum })
      const esperadoData = series.map((_, i) =>
        n > 1 ? totalFat * (i / (n - 1)) : totalFat,
      )
      const slateColor = isDark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.55)'
      return {
        labels: series.map(p => p.label),
        datasets: [
          {
            label: 'Esperado',
            data: esperadoData,
            borderColor: slateColor,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            cubicInterpolationMode: 'monotone' as const,
            tension: 0,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 20,
            pointBackgroundColor: slateColor,
            pointBorderColor: pBorder,
            pointBorderWidth: 1.5,
            pointHoverBorderWidth: 1.5,
          },
          realDs,
        ],
      }
    }

    realDs.label = 'Gastos do dia'
    realDs.data  = series.map(p => p.total)
    return {
      labels: series.map(p => p.label),
      datasets: [realDs],
    }
    // hasData and totalFat are derived from series — not separate dependencies
  }, [series, isDark, visao])

  // options depends only on isDark — series data is read via seriesRef in
  // callbacks, so filter changes don't rebuild options or trigger re-animation.
  const options = useMemo(() => {
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: { duration: 350, easing: 'easeOutQuart' as const },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (context: { tooltip: { opacity: number; dataPoints?: { dataIndex: number; datasetIndex: number; parsed: { y: number | null } }[] } }) => {
            if (context.tooltip.opacity === 0) {
              setHoveredPoint(null)
              setBurndownHover(null)
              return
            }
            const dp  = context.tooltip.dataPoints ?? []
            const idx = dp[0]?.dataIndex ?? -1
            const pt  = seriesRef.current[idx]
            if (!pt) return
            if (visao === 'acumulado') {
              const esperado = dp.find(d => d.datasetIndex === 0)?.parsed.y ?? 0
              const real     = dp.find(d => d.datasetIndex === 1)?.parsed.y ?? 0
              setBurndownHover({ fullLabel: pt.fullLabel, real, esperado })
            } else {
              setHoveredPoint({ fullLabel: pt.fullLabel, total: pt.total, count: pt.count })
            }
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v: number | string) => {
              const n = Number(v)
              if (n === 0) return 'R$0'
              if (n >= 1000) return `R$${(n / 1000).toFixed(0)}k`
              return `R$${n.toFixed(0)}`
            },
            font: { size: 10 },
            maxTicksLimit: 3,
            color: txt,
          },
          grid: { color: grid, lineWidth: 1 },
          border: { display: false },
        },
        x: {
          ticks: {
            font: { size: 10 },
            color: (ctx: { index: number }) => {
              const pt = seriesRef.current[ctx.index]
              if (!pt) return txt
              const day = new Date(pt.isoDate + 'T12:00:00').getDay()
              return (day === 0 || day === 6)
                ? (isDark ? 'rgba(226,232,240,0.85)' : rgb(0.85))
                : txt
            },
            padding: 4,
            maxRotation: 0,
            callback: (_v: number | string, index: number) => {
              const len = seriesRef.current.length
              const pt = seriesRef.current[index]
              if (!pt) return ''
              const day = new Date(pt.isoDate + 'T12:00:00').getDay()
              if (index === 0 || index === len - 1 || day === 0 || day === 6) {
                return pt.label
              }
              return ''
            },
          },
          grid: { display: false },
          border: { display: false },
        },
      },
    }
  }, [isDark, visao])

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
      {/* Filters — two selects side by side with chevron indicator */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <select
            value={filtroResp}
            onChange={e => setFiltroResp(e.target.value as FiltroResponsavel)}
            className={SELECT_CLS}
          >
            <option value="todos">Todos</option>
            <option value="Matheus">Matheus</option>
            <option value="Jeniffer">Jeniffer</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        </div>

        <div className="relative flex-1">
          <select
            value={filtroCartao}
            onChange={e => setFiltroCartao(e.target.value as FiltroCartao)}
            className={SELECT_CLS}
          >
            <option value="todos">Todos os cartões</option>
            <option value="nubank">NuBank</option>
            <option value="cartao1">{cartao1Nome}</option>
            <option value="cartao2">{cartao2Nome}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        </div>
      </div>

      {!hasData ? (
        <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400">
          <Activity className="w-9 h-9 opacity-30" />
          <p className="text-sm font-medium text-gray-500">Sem lançamentos no período</p>
          <p className="text-xs text-gray-400">
            {filtroResp !== 'todos' || filtroCartao !== 'todos'
              ? 'Nenhum gasto encontrado com os filtros selecionados'
              : 'Os gastos por dia aparecerão aqui conforme forem registrados'}
          </p>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
                Total da fatura
              </p>
              <p className="text-xl font-bold text-violet-500 num">{formatBRL(totalFat)}</p>
            </div>
            {peakDay.total > 0 && (
              <div className="text-right">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
                  Maior gasto
                </p>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-sm font-semibold text-gray-300 num">
                    {formatBRL(peakDay.total)}
                  </span>
                  <span className="text-[10px] text-gray-400 bg-white/10 rounded-full px-2 py-0.5">
                    {peakDay.label}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Hovered-day info — updates as user drags over the chart */}
          <div className="h-8 mb-4 flex items-center">
            {visao === 'acumulado' ? (
              acumuladoHover ? (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-bold text-violet-400 num">{formatBRL(acumuladoHover.real)}</span>
                  <span className="text-[11px] text-gray-500">real</span>
                  <span className="text-[11px] text-gray-600">·</span>
                  <span className="text-sm font-semibold text-slate-400 num">{formatBRL(acumuladoHover.esperado)}</span>
                  <span className="text-[11px] text-gray-500">esperado</span>
                  <span className="text-[11px] text-gray-600">·</span>
                  <span className="text-xs text-gray-400">{acumuladoHover.fullLabel}</span>
                </div>
              ) : (
                <span className="text-[11px] text-gray-600 select-none">Arraste para comparar real vs esperado</span>
              )
            ) : hoveredPoint ? (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-violet-400 num">{formatBRL(hoveredPoint.total)}</span>
                <span className="text-xs text-gray-400">{hoveredPoint.fullLabel}</span>
                {hoveredPoint.count > 0 && (
                  <span className="text-[11px] text-gray-500">
                    · {hoveredPoint.count} lançamento{hoveredPoint.count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-gray-600 select-none">Arraste para ver o dia</span>
            )}
          </div>

          <div className="h-40 md:h-48 lg:h-52">
            {chartData && <Line data={chartData} options={options} plugins={plugins} />}
          </div>
        </>
      )}
    </div>
  )
}
