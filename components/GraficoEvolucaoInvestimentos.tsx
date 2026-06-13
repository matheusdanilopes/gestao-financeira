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
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle, PiggyBank } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import type { TooltipItem, Plugin } from 'chart.js'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

interface GradientChart {
  ctx: CanvasRenderingContext2D
  chartArea?: { top: number; bottom: number }
  data: { datasets: Array<{ backgroundColor?: string | CanvasGradient | null }> }
}

const MESES = 6
const POLL_DELAY = 20_000 // ms — escalonado para não coincidir com EvolucaoMensal

const VIOLET = { r: 124, g: 58,  b: 237 } // violet-600 — realizado
const TEAL   = { r: 20,  g: 184, b: 166 } // teal-500   — meta

function rgba(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface DadosInvestimento {
  labels: string[]
  realizado: number[]
  meta: number[]
}

interface Props {
  mesAtual: Date
}

// Gradients: realizado (violet fill) + meta (teal very faint fill)
const gradientPlugin = {
  id: 'gradientFillInv',
  beforeDatasetsDraw(chart: GradientChart) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const [ds0, ds1] = chart.data.datasets

    if (ds0) {
      const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
      g.addColorStop(0,    rgba(VIOLET, 0.28))
      g.addColorStop(0.55, rgba(VIOLET, 0.06))
      g.addColorStop(1,    rgba(VIOLET, 0))
      ds0.backgroundColor = g
    }
    if (ds1) {
      const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
      g.addColorStop(0,   rgba(TEAL, 0.10))
      g.addColorStop(0.6, rgba(TEAL, 0.02))
      g.addColorStop(1,   rgba(TEAL, 0))
      ds1.backgroundColor = g
    }
  },
}

export default function GraficoEvolucaoInvestimentos({ mesAtual }: Props) {
  const [dados, setDados] = useState<DadosInvestimento | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark, isDarkRef } = useIsDark()
  const dataCache = useRef(new Map<string, DadosInvestimento>())

  // Plugin criado uma única vez — lê isDarkRef.current no draw, sem recriar objeto
  const plugins = useMemo(
    () => [gradientPlugin, makeCrosshairPlugin('crosshairInv', isDarkRef)] as Plugin<'line'>[],
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
      const hojeRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')

      const mesesRef: string[] = []
      for (let i = MESES - 1; i >= 0; i--)
        mesesRef.push(format(startOfMonth(subMonths(mesAtual, i)), 'yyyy-MM-dd'))

      const inicioPeriodo = mesesRef[0]
      const fimPeriodo    = format(endOfMonth(mesAtual), 'yyyy-MM-dd')

      const [{ data: aportes }, { data: invPlano }, { data: plan }] = await Promise.all([
        supabase
          .from('investimentos_aportes')
          .select('valor, data_aporte')
          .gte('data_aporte', inicioPeriodo)
          .lte('data_aporte', fimPeriodo),
        supabase
          .from('investimentos')
          .select('percentual, mes_referencia')
          .in('mes_referencia', mesesRef),
        supabase
          .from('planejamento')
          .select('item, valor_previsto, valor_real, pago, mes_referencia')
          .in('mes_referencia', mesesRef),
      ])

      const aportesMap = new Map<string, number>()
      for (const a of (aportes || [])) {
        const mes = format(startOfMonth(new Date(a.data_aporte + 'T12:00:00')), 'yyyy-MM-dd')
        aportesMap.set(mes, (aportesMap.get(mes) || 0) + a.valor)
      }

      const pctMap = new Map<string, number>()
      for (const iv of (invPlano || [])) {
        const mes: string = iv.mes_referencia
        pctMap.set(mes, (pctMap.get(mes) || 0) + iv.percentual)
      }

      const recMap = new Map<string, number>()
      const desMap = new Map<string, number>()
      for (const p of (plan || [])) {
        const mes: string = p.mes_referencia
        const item  = String(p.item || '')
        const isPast = mes < hojeRef
        const valor = isPast && p.pago && p.valor_real != null ? p.valor_real : (p.valor_previsto || 0)
        if (item === 'Receita Total' || item.startsWith('[RECEITA]'))
          recMap.set(mes, (recMap.get(mes) || 0) + valor)
        else
          desMap.set(mes, (desMap.get(mes) || 0) + valor)
      }

      const realizado: number[] = []
      const meta: number[] = []

      for (const mes of mesesRef) {
        realizado.push(aportesMap.get(mes) || 0)
        const pct   = pctMap.get(mes) || 0
        const saldo = (recMap.get(mes) || 0) - (desMap.get(mes) || 0)
        meta.push(pct > 0 && saldo > 0 ? (saldo * pct) / 100 : 0)
      }

      const novosDados = {
        labels: mesesRef.map(m =>
          format(new Date(m + 'T12:00:00'), 'MMM/yy', { locale: ptBR })
        ),
        realizado,
        meta,
      }
      dataCache.current.set(mesKey, novosDados)
      if (dataCache.current.size > 12) {
        const oldest = dataCache.current.keys().next().value
        if (oldest) dataCache.current.delete(oldest)
      }
      setDados(novosDados)
    } catch {
      setErro('Não foi possível carregar a evolução de investimentos.')
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

    return {
      labels: dados.labels,
      datasets: [
        {
          label: 'Realizado',
          data: dados.realizado,
          borderColor: rgba(VIOLET),
          backgroundColor: 'transparent', // filled by gradientPlugin
          borderWidth: 2.5,
          tension: 0.42,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 10,
          pointHitRadius: 24,
          pointBackgroundColor: rgba(VIOLET),
          pointBorderColor: pBorder,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2.5,
        },
        {
          label: 'Meta',
          data: dados.meta,
          borderColor: rgba(TEAL, 0.85),
          backgroundColor: 'transparent', // filled by gradientPlugin
          borderWidth: 1.5,
          borderDash: [6, 4],
          tension: 0.42,
          fill: true,
          spanGaps: true,
          pointRadius: 2,
          pointHoverRadius: 7,
          pointHitRadius: 24,
          pointBackgroundColor: rgba(TEAL),
          pointBorderColor: pBorder,
          pointBorderWidth: 1.5,
          pointHoverBorderWidth: 2,
        },
      ],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)'
    const tbg  = isDark ? 'rgba(15,23,42,0.97)'   : 'rgba(15,23,42,0.93)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: { duration: 350, easing: 'easeOutQuart' as const },
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: {
            font: { size: 12 },
            boxWidth: 28,
            boxHeight: 3,
            padding: 24,
            color: txt,
            usePointStyle: false,
          },
        },
        tooltip: {
          backgroundColor: tbg,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          padding: { top: 10, right: 16, bottom: 10, left: 16 },
          cornerRadius: 12,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: false,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => items[0]?.label ?? '',
            label: (ctx: TooltipItem<'line'>) => `  ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v: number | string) => formatBRL(Number(v)),
            font: { size: 10 },
            maxTicksLimit: 5,
            color: txt,
          },
          grid: { color: grid, lineWidth: 1 },
          border: { display: false, dash: [4, 4] },
        },
        x: {
          ticks: { font: { size: 11 }, color: txt, padding: 8 },
          grid: { display: false },
          border: { display: false },
        },
      },
    }
  }, [isDark])

  if (carregando) {
    return (
      <div className="h-56 animate-pulse">
        <div className="h-full flex flex-col gap-2 pt-2 pb-6">
          <div className="flex-1 flex items-end gap-1 px-2">
            {[30, 50, 42, 65, 55, 70].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-lg bg-gray-100 dark:bg-white/[0.05]"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="flex gap-4 justify-center">
            <div className="h-2 w-16 bg-gray-100 dark:bg-white/[0.05] rounded-full" />
            <div className="h-2 w-16 bg-gray-100 dark:bg-white/[0.05] rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="h-56 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button
          onClick={() => { setCarregando(true); carregar() }}
          className="text-xs text-violet-500 hover:text-violet-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  const hasData =
    dados !== null &&
    (dados.realizado.some(v => v > 0) || dados.meta.some(v => v > 0))

  if (!hasData) {
    return (
      <div className="h-56 flex flex-col items-center justify-center gap-2 text-gray-400">
        <PiggyBank className="w-8 h-8 opacity-40" />
        <span className="text-sm text-center">
          Nenhum dado de investimento nos últimos 6 meses.
        </span>
        <a href="/investimentos" className="text-xs text-violet-500 underline">
          Configurar metas
        </a>
      </div>
    )
  }

  if (!chartData) return null

  return (
    <div>
      <div className="h-56 md:h-64 lg:h-72">
        <Line data={chartData} options={options} plugins={plugins} />
      </div>
    </div>
  )
}
