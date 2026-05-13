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
  Legend,
  Filler,
} from 'chart.js'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

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
  beforeDatasetsDraw(chart: any) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    chart.data.datasets.forEach((ds: any, i: number) => {
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

  // Plugin criado uma única vez — lê isDarkRef.current no draw, sem recriar objeto
  const plugins = useMemo(
    () => [gradientPlugin, makeCrosshairPlugin('crosshair', isDarkRef)],
    [isDarkRef],
  )

  const carregar = useCallback(async () => {
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

      setDados({
        labels:            mesesRef.map(m => format(new Date(m + 'T12:00:00'), 'MMM/yy', { locale: ptBR })),
        receitas:          mesesRef.map(m => rec.get(m) || 0),
        despesas:          mesesRef.map(m => des.get(m) || 0),
        currentMonthIndex: mesesRef.findIndex(m => m === hojeRef),
      })
    } catch {
      setErro('Não foi possível carregar a evolução financeira.')
    } finally {
      setCarregando(false)
    }
  }, [mesAtual])

  useEffect(() => {
    setCarregando(true)
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
      borderWidth: 2.5,
      tension: 0.42,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 9,
      pointHitRadius: 24,
      pointBackgroundColor: rgb(PALETTE[pi]),
      pointBorderColor: pBorder,
      pointBorderWidth: 2.5,
      pointHoverBorderWidth: 2.5,
      // Segments from currentMonthIndex onward → dashed + lighter (forecast)
      ...(cmi >= 0 ? {
        segment: {
          borderDash:  (ctx: any) => ctx.p1DataIndex >= cmi ? [7, 4] : undefined,
          borderColor: (ctx: any) => ctx.p1DataIndex >= cmi
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
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)'
    const tbg  = isDark ? 'rgba(15,23,42,0.97)'   : 'rgba(15,23,42,0.93)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: { duration: 750, easing: 'easeInOutCubic' as const },
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
          bodyColor:  '#94a3b8',
          padding: { top: 10, right: 16, bottom: 10, left: 16 },
          cornerRadius: 12,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          callbacks: {
            title: (items: any[]) => items[0]?.label ?? '',
            label: (ctx: any) => `  ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v: any) => formatBRL(Number(v)),
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

  /* ── loading ── */
  if (carregando) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    )
  }

  /* ── error ── */
  if (erro) {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-8 h-8" />
        <span className="text-sm">{erro}</span>
        <button
          onClick={() => { setCarregando(true); carregar() }}
          className="text-xs text-blue-500 underline"
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
        <p className="flex items-center justify-center gap-5 text-[11px] text-gray-400 mt-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 h-0.5 rounded-full bg-gray-400" />
            Realizado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t border-dashed border-gray-400" />
            Previsto
          </span>
        </p>
      )}
    </div>
  )
}
