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
import { format, startOfMonth, addMonths, addDays, eachDayOfInterval } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Activity, AlertCircle } from 'lucide-react'
import FilterSelect from '@/components/FilterSelect'
import { formatBRL } from '@/lib/format'
import { supabase } from '@/lib/supabaseClient'
import type { Plugin } from 'chart.js'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'
import { CHART_ANIMATION } from '@/lib/chartTheme'

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

function makeTodayLinePlugin(
  seriesRef: { current: DatePoint[] },
  isDarkRef: { current: boolean },
  visaoRef: { current: Visao },
): Plugin<'line'> {
  return {
    id: 'gastosDiariosTodayLine',
    afterDatasetsDraw(chart: unknown) {
      if (visaoRef.current !== 'burndown') return
      const c = chart as WeekendChart
      if (!c.chartArea) return
      const series = seriesRef.current
      const todayIso = format(new Date(), 'yyyy-MM-dd')
      const idx = series.findIndex(p => p.isoDate === todayIso)
      if (idx < 0) return
      const x = c.scales.x.getPixelForValue(idx)
      const { top, height } = c.chartArea
      const isDark = isDarkRef.current
      c.ctx.save()
      c.ctx.strokeStyle = isDark ? 'rgba(226,232,240,0.18)' : 'rgba(100,116,139,0.18)'
      c.ctx.lineWidth = 1
      c.ctx.beginPath()
      c.ctx.moveTo(x, top)
      c.ctx.lineTo(x, top + height)
      c.ctx.stroke()
      c.ctx.fillStyle = isDark ? 'rgba(226,232,240,0.35)' : 'rgba(100,116,139,0.35)'
      c.ctx.font = '9px system-ui, sans-serif'
      c.ctx.textAlign = 'center'
      c.ctx.fillText('hoje', x, top + 9)
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

type FiltroResponsavel = 'todos' | 'Matheus' | 'Jeniffer'
type FiltroCartao      = 'todos' | 'nubank'  | 'cartao1' | 'cartao2'
type Visao             = 'valor' | 'burndown'

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
  projecao: number | null
}

export type { Visao }

interface PrevistoPorFiltro {
  matheus: number   // NuBank Matheus
  jeniffer: number  // NuBank Jeniffer
  cartao1: number   // Cartão 1 total (sem breakdown por pessoa)
  cartao2: number   // Cartão 2 total (sem breakdown por pessoa)
}

interface Props {
  mesAtual: Date
  cartao1Nome?: string
  cartao2Nome?: string
  visao: Visao
  previsto?: PrevistoPorFiltro
  dataFechamentoFatura?: string | null
}

export default function GraficoGastosDiarios({
  mesAtual,
  cartao1Nome = 'Cartão 1',
  cartao2Nome = 'Cartão 2',
  visao,
  previsto,
  dataFechamentoFatura,
}: Props) {
  const [rawData, setRawData]           = useState<TransacaoRaw[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [filtroResp, setFiltroResp]     = useState<FiltroResponsavel>('todos')
  const [filtroCartao, setFiltroCartao] = useState<FiltroCartao>('todos')
  const { isDark, isDarkRef }           = useIsDark()
  const visaoRef = useRef<Visao>(visao)
  useEffect(() => { visaoRef.current = visao }, [visao])

  // Kept in a ref so tooltip callbacks always read current series without
  // adding series to the options dependency array (which would re-animate
  // the chart on every filter change).
  const seriesRef = useRef<DatePoint[]>([])
  const [hoveredPoint, setHoveredPoint]     = useState<HoveredPoint | null>(null)
  const [burndownHover, setBurndownHover]   = useState<BurndownHover | null>(null)

  // Reset hover state when switching views so stale data doesn't persist
  useEffect(() => {
    setHoveredPoint(null)
    setBurndownHover(null)
  }, [visao])

  const weekendPlugin = useMemo(
    () => makeWeekendBandPlugin(seriesRef, isDarkRef),
    [isDarkRef],
  )

  const todayPlugin = useMemo(
    () => makeTodayLinePlugin(seriesRef, isDarkRef, visaoRef),
    [isDarkRef, visaoRef],
  )

  const plugins = useMemo(
    () => [gradientPlugin, weekendPlugin, todayPlugin, makeCrosshairPlugin('gastosDiariosCrosshair', isDarkRef, 0.12, 0.08)] as Plugin<'line'>[],
    [isDarkRef, weekendPlugin, todayPlugin],
  )

  const mesRefFatura = useMemo(
    () => format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd'),
    [mesAtual],
  )

  const carregar = useCallback(async () => {
    setError(null)
    try {
      const txResult = await supabase
        .from('transacoes_nubank')
        .select('valor, data_compra, responsavel, cartao, descricao, parcela_atual, total_parcelas')
        .eq('projeto_fatura', mesRefFatura)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO')
      const { data, error: err } = txResult

      if (err) {
        if (err.message?.includes('data_compra')) {
          // Legacy schema: column named 'data' instead of 'data_compra'
          const { data: legacyData, error: legacyErr } = await supabase
            .from('transacoes_nubank')
            .select('valor, data, responsavel, cartao, descricao, parcela_atual, total_parcelas')
            .eq('projeto_fatura', mesRefFatura)
            .neq('status', 'ESTORNO')
            .neq('status', 'ESTORNADO')
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

  // In burndown mode, extend series with zero-spend days up to the invoice closing date
  // so the Esperado line reaches exactly 0 on that day.
  const chartSeries = useMemo((): DatePoint[] => {
    if (visao !== 'burndown' || !dataFechamentoFatura || series.length === 0) return series
    const endDate  = new Date(dataFechamentoFatura + 'T12:00:00')
    const lastDate = new Date(series[series.length - 1].isoDate + 'T12:00:00')
    if (endDate <= lastDate) return series
    return [
      ...series,
      ...eachDayOfInterval({ start: addDays(lastDate, 1), end: endDate }).map(d => ({
        isoDate:   format(d, 'yyyy-MM-dd'),
        label:     format(d, 'd/MMM', { locale: ptBR }),
        fullLabel: format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR }),
        total: 0,
        count: 0,
      })),
    ]
  }, [series, visao, dataFechamentoFatura])

  // Keep ref in sync so options callbacks can read it without deps
  useEffect(() => { seriesRef.current = chartSeries }, [chartSeries])

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
      borderWidth: 2,
      cubicInterpolationMode: 'monotone' as const,
      tension: 0.42,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHitRadius: 30,
      pointBackgroundColor: rgb(1),
      pointBorderColor: pBorder,
      pointBorderWidth: 2,
      pointHoverBorderWidth: 2,
    }

    if (visao === 'burndown') {
      const n = chartSeries.length

      // Previsto filtrado: NuBank tem breakdown por responsável; cartão 1/2 não têm
      const previstoBruto = previsto
        ? (() => {
            let v = 0
            if (filtroCartao === 'todos' || filtroCartao === 'nubank') {
              if (filtroResp === 'todos')         v += previsto.matheus + previsto.jeniffer
              else if (filtroResp === 'Matheus')  v += previsto.matheus
              else if (filtroResp === 'Jeniffer') v += previsto.jeniffer
            }
            if (filtroCartao === 'todos' || filtroCartao === 'cartao1') v += previsto.cartao1
            if (filtroCartao === 'todos' || filtroCartao === 'cartao2') v += previsto.cartao2
            return v
          })()
        : totalFat

      // Dedução 1: parcelas 2/X em diante presentes nesta fatura (já filtradas por resp/cartão)
      const deducaoParcelas = rawData
        .filter(tx =>
          (filtroResp === 'todos'    || tx.responsavel === filtroResp) &&
          (filtroCartao === 'todos'  || tx.cartao === filtroCartao) &&
          ehParcelaNaoInicial(tx),
        )
        .reduce((s, tx) => s + tx.valor, 0)

      const metaEsperado = Math.max(0, previstoBruto - deducaoParcelas)
      let cum = 0
      realDs.data = chartSeries.map(p => { cum += p.total; return metaEsperado - cum })

      // Dynamic projection: starts at today's real value, ends at estimated close
      // based on current average daily spending — not a rigid linear budget line.
      const todayIso   = format(new Date(), 'yyyy-MM-dd')
      const todayIdx   = chartSeries.findIndex(p => p.isoDate === todayIso)
      const remDays    = todayIdx >= 0 ? n - 1 - todayIdx : 0
      const projData: (number | null)[] = chartSeries.map(() => null)
      if (todayIdx >= 0 && remDays > 0) {
        let cumToday = 0
        for (let i = 0; i <= todayIdx; i++) cumToday += chartSeries[i].total
        const realValueToday  = metaEsperado - cumToday
        const avgDailySpend   = cumToday / (todayIdx + 1)
        const projectedFinal  = realValueToday - avgDailySpend * remDays
        projData[todayIdx] = realValueToday
        for (let i = todayIdx + 1; i < n; i++) {
          const t = (i - todayIdx) / remDays
          projData[i] = realValueToday + t * (projectedFinal - realValueToday)
        }
      }

      const slateColor = isDark ? 'rgba(148,163,184,0.75)' : 'rgba(100,116,139,0.70)'
      return {
        labels: chartSeries.map(p => p.label),
        datasets: [
          {
            label: 'Projeção',
            data: projData,
            borderColor: slateColor,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            tension: 0,
            fill: false,
            spanGaps: false,
            pointRadius: (ctx: { dataIndex: number }) =>
              ctx.dataIndex === todayIdx ? 3 : 0,
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
  }, [series, chartSeries, isDark, visao, filtroResp, filtroCartao, previsto, rawData])

  // Y-axis floor: 0 when within budget; 10% below the worst value across ALL datasets
  const minY = useMemo(() => {
    if (visao !== 'burndown' || !chartData) return 0
    const allValues = chartData.datasets.flatMap(ds =>
      (ds.data as (number | null)[]).filter((v): v is number => v !== null),
    )
    if (allValues.length === 0) return 0
    const menor = Math.min(...allValues)
    return menor >= 0 ? 0 : menor * 1.1
  }, [visao, chartData])

  // Y-axis ceiling: 10% above the highest value across all datasets
  const maxY = useMemo(() => {
    if (visao !== 'burndown' || !chartData) return undefined
    const allValues = chartData.datasets.flatMap(ds =>
      (ds.data as (number | null)[]).filter((v): v is number => v !== null),
    )
    if (allValues.length === 0) return undefined
    const maior = Math.max(...allValues)
    if (maior === 0) return undefined
    return maior > 0 ? maior * 1.1 : maior * 0.9
  }, [visao, chartData])

  // options depends only on isDark — series data is read via seriesRef in
  // callbacks, so filter changes don't rebuild options or trigger re-animation.
  const options = useMemo(() => {
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: CHART_ANIMATION,
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
            if (visao === 'burndown') {
              const projecao = dp.find(d => d.datasetIndex === 0)?.parsed.y ?? null
              const real     = dp.find(d => d.datasetIndex === 1)?.parsed.y ?? 0
              setBurndownHover({ fullLabel: pt.fullLabel, real, projecao })
            } else {
              setHoveredPoint({ fullLabel: pt.fullLabel, total: pt.total, count: pt.count })
            }
          },
        },
      },
      scales: {
        y: {
          min: minY,
          max: maxY,
          ticks: {
            callback: (v: number | string) => {
              const n = Number(v)
              if (n === 0) return 'R$0'
              if (n >= 1000) return `R$${(n / 1000).toFixed(0)}k`
              if (n <= -1000) return `-R$${(Math.abs(n) / 1000).toFixed(0)}k`
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
  }, [isDark, visao, minY, maxY])

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 h-[34px] bg-gray-100 dark:bg-white/[0.05] rounded-xl" />
          <div className="flex-1 h-[34px] bg-gray-100 dark:bg-white/[0.05] rounded-xl" />
        </div>
        <div className="h-48 flex items-end gap-0.5 px-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-gray-100 dark:bg-white/[0.05]"
              style={{ height: `${20 + Math.sin(i * 0.8) * 30 + Math.random() * 20}%` }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{error}</span>
        <button
          onClick={() => { setLoading(true); carregar() }}
          className="text-xs text-violet-500 hover:text-violet-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Filters — pílulas de filtro (mesma aparência da Wishlist) */}
      <div className="flex gap-2 mb-4">
        <FilterSelect
          value={filtroResp}
          onChange={v => setFiltroResp(v as FiltroResponsavel)}
          options={[
            { value: 'todos',    label: 'Todos'    },
            { value: 'Matheus',  label: 'Matheus'  },
            { value: 'Jeniffer', label: 'Jeniffer' },
          ]}
        />
        <FilterSelect
          value={filtroCartao}
          onChange={v => setFiltroCartao(v as FiltroCartao)}
          options={[
            { value: 'todos',   label: 'Todos os cartões' },
            { value: 'nubank',  label: 'NuBank'           },
            { value: 'cartao1', label: cartao1Nome        },
            { value: 'cartao2', label: cartao2Nome        },
          ]}
        />
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
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
                Total da fatura
              </p>
              <p className="text-2xl font-bold text-violet-500 num leading-none">{formatBRL(totalFat)}</p>
            </div>
            {peakDay.total > 0 && (
              <div className="text-right">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
                  Maior gasto
                </p>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-sm font-bold text-gray-600 num">
                    {formatBRL(peakDay.total)}
                  </span>
                  <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                    {peakDay.label}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Hovered-day info — updates as user drags over the chart */}
          <div className="min-h-[2.5rem] mb-4 flex items-start">
            {visao === 'burndown' ? (
              burndownHover ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-bold text-violet-400 num">{formatBRL(burndownHover.real)}</span>
                    <span className="text-[11px] text-gray-500">restante</span>
                    <span className="text-[11px] text-gray-400">·</span>
                    <span className="text-xs text-gray-400">{burndownHover.fullLabel}</span>
                  </div>
                  {burndownHover.projecao !== null && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm font-semibold text-slate-400 num">{formatBRL(burndownHover.projecao)}</span>
                      <span className="text-[11px] text-gray-500">tendência de fechamento</span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-gray-600 select-none">Arraste para ver o saldo restante</span>
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
