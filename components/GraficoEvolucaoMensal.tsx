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
  Legend,
  Filler,
} from 'chart.js'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import type { ScriptableLineSegmentContext, TooltipItem, Plugin } from 'chart.js'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'
import { CHART_ANIMATION, tooltipCfg, yScaleCfg, xScaleCfg, legendCfg } from '@/lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

interface GradientChart {
  ctx: CanvasRenderingContext2D
  chartArea?: { top: number; bottom: number }
  data: { datasets: Array<{ backgroundColor?: string | CanvasGradient | null }> }
}

const MESES_HISTORICO = 6
const POLL_DELAY = 0 // ms — sem stagger, é o primeiro a carregar

const PALETTE = [
  { r: 16,  g: 185, b: 129 }, // Receitas — emerald
  { r: 239, g: 68,  b: 68  }, // Despesas — red
] as const

function rgb(p: (typeof PALETTE)[number], a = 1) {
  return `rgba(${p.r},${p.g},${p.b},${a})`
}

interface EvolucaoMensal {
  labels: string[]
  receitas: number[]
  despesas: number[]
  /** Index of today's month in the array; -1 when outside the displayed window */
  currentMonthIndex: number
}

interface Props {
  mesAtual: Date
}

// Plugin: canvas gradient fills — recalculated each draw so resizes are handled
const gradientPlugin = {
  id: 'gradientFill',
  beforeDatasetsDraw(chart: GradientChart) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    chart.data.datasets.forEach((ds, i: number) => {
      const p = PALETTE[i]
      if (!p) return
      const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
      g.addColorStop(0,   rgb(p, 0.18))
      g.addColorStop(0.5, rgb(p, 0.05))
      g.addColorStop(1,   rgb(p, 0))
      ds.backgroundColor = g
    })
  },
}

export default function GraficoEvolucaoMensal({ mesAtual }: Props) {
  const [dados, setDados] = useState<EvolucaoMensal | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark, isDarkRef } = useIsDark()
  const dataCache = useRef(new Map<string, EvolucaoMensal>())

  // Plugin criado uma única vez — lê isDarkRef.current no draw, sem recriar objeto
  const plugins = useMemo(
    () => [gradientPlugin, makeCrosshairPlugin('crosshair', isDarkRef)] as Plugin<'line'>[],
    [isDarkRef],
  )

  const carregar = useCallback(async () => {
    const mesKey = format(mesAtual, 'yyyy-MM')
    const cached = dataCache.current.get(mesKey)
    if (cached) {
      setDados(cached)
    } else {
      setCarregando(true)
    }
    setErro(null)
    try {
      const mesesRef: string[] = []
      for (let i = MESES_HISTORICO - 1; i >= 0; i--)
        mesesRef.push(format(startOfMonth(subMonths(mesAtual, i)), 'yyyy-MM-dd'))

      // Today's month reference — used to split real vs. forecast
      const hojeRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')

      const { data: plan } = await supabase
        .from('planejamento')
        .select('item, valor_previsto, valor_real, pago, mes_referencia')
        .in('mes_referencia', mesesRef)

      const rec = new Map<string, number>()
      const des = new Map<string, number>()

      for (const p of (plan || [])) {
        const mes: string = p.mes_referencia
        const item = String(p.item || '')

        // Past months → use valor_real when the item was actually paid/received;
        // fall back to valor_previsto when there is no real record.
        // Current month and future → always use valor_previsto (forecast).
        const isPast = mes < hojeRef
        const valor = isPast && p.pago && p.valor_real != null
          ? p.valor_real
          : (p.valor_previsto || 0)

        if (item === 'Receita Total' || item.startsWith('[RECEITA]'))
          rec.set(mes, (rec.get(mes) || 0) + valor)
        else
          des.set(mes, (des.get(mes) || 0) + valor)
      }

      const novosDados = {
        labels:            mesesRef.map(m => format(new Date(m + 'T12:00:00'), 'MMM/yy', { locale: ptBR })),
        receitas:          mesesRef.map(m => rec.get(m) || 0),
        despesas:          mesesRef.map(m => des.get(m) || 0),
        currentMonthIndex: mesesRef.findIndex(m => m === hojeRef),
      }
      dataCache.current.set(mesKey, novosDados)
      if (dataCache.current.size > 12) {
        const oldest = dataCache.current.keys().next().value
        if (oldest) dataCache.current.delete(oldest)
      }
      setDados(novosDados)
    } catch {
      setErro('Não foi possível carregar a evolução financeira.')
    } finally {
      setCarregando(false)
    }
  }, [mesAtual])

  useEffect(() => {
    carregar()
    let intervalId: ReturnType<typeof setInterval>
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(carregar, 60_000)
    }, POLL_DELAY)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [carregar])

  const chartData = useMemo(() => {
    if (!dados) return null
    const pBorder = isDark ? '#0f172a' : '#ffffff'
    const cmi = dados.currentMonthIndex

    const mkDs = (label: string, data: number[], pi: number) => ({
      label,
      data,
      borderColor: rgb(PALETTE[pi]),
      backgroundColor: 'transparent', // overwritten by gradientPlugin each draw
      borderWidth: 2,
      tension: 0.45,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 7,
      pointHitRadius: 28,
      pointBackgroundColor: rgb(PALETTE[pi]),
      pointBorderColor: pBorder,
      pointBorderWidth: 2,
      pointHoverBorderWidth: 2,
      // Segments from currentMonthIndex onward → dashed + lighter (forecast)
      ...(cmi >= 0 ? {
        segment: {
          borderDash:  (ctx: ScriptableLineSegmentContext) => ctx.p1DataIndex >= cmi ? [7, 4] : undefined,
          borderColor: (ctx: ScriptableLineSegmentContext) => ctx.p1DataIndex >= cmi
            ? rgb(PALETTE[pi], 0.50)
            : rgb(PALETTE[pi]),
        },
      } : {}),
    })

    return {
      labels: dados.labels,
      datasets: [
        mkDs('Receitas', dados.receitas, 0),
        mkDs('Despesas', dados.despesas, 1),
      ],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: CHART_ANIMATION,
      plugins: {
        legend: legendCfg(isDark),
        tooltip: {
          ...tooltipCfg(isDark),
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => items[0]?.label ?? '',
            label: (ctx: TooltipItem<'line'>) => {
              const total = (dados?.receitas ?? []).reduce((s, v) => s + v, 0) +
                            (dados?.despesas ?? []).reduce((s, v) => s + v, 0)
              const pct = total > 0 ? ((ctx.parsed.y ?? 0) / total * 100).toFixed(1) : null
              const suffix = pct ? ` (${pct}%)` : ''
              return `  ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y ?? 0)}${suffix}`
            },
          },
        },
      },
      scales: {
        y: yScaleCfg(isDark, { callback: (v) => formatBRL(Number(v)) }),
        x: xScaleCfg(isDark),
      },
    }
  }, [isDark, dados])

  /* ── loading ── */
  if (carregando) {
    return (
      <div className="h-56 md:h-64 lg:h-72 animate-pulse flex flex-col justify-between pt-3 pb-2 px-2">
        {/* Y-axis ticks */}
        <div className="flex flex-col justify-between h-[calc(100%-28px)] gap-0">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2.5 rounded-full bg-gray-100 dark:bg-white/[0.05]" style={{ width: 36 + i * 4 }} />
              <div className="flex-1 h-px bg-gray-100 dark:bg-white/[0.04]" />
            </div>
          ))}
        </div>
        {/* Legend placeholders */}
        <div className="flex gap-5 justify-center mt-2">
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-5 bg-emerald-200 dark:bg-emerald-900/40 rounded-full" />
            <div className="h-2 w-12 bg-gray-100 dark:bg-white/[0.05] rounded-full" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-5 bg-red-200 dark:bg-red-900/40 rounded-full" />
            <div className="h-2 w-12 bg-gray-100 dark:bg-white/[0.05] rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  /* ── error ── */
  if (erro) {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button
          onClick={() => { setCarregando(true); carregar() }}
          className="text-xs text-primary-500 hover:text-primary-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!chartData) return null

  const showHint = dados !== null && dados.currentMonthIndex >= 0

  return (
    <div>
      <div className="h-56 md:h-64 lg:h-72">
        <Line data={chartData} options={options} plugins={plugins} />
      </div>

      {showHint && (
        <p className="flex items-center justify-center gap-5 text-[11px] text-gray-400 dark:text-gray-500 mt-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-0.5 rounded-full bg-current" />
            Realizado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t border-dashed border-current" />
            Previsto
          </span>
        </p>
      )}
    </div>
  )
}
