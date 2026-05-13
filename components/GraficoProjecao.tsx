'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { addMonths, format, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { MousePointerClick, AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { useTheme } from '@/components/ThemeProvider'

const PROJECAO_OFFSET_MESES = 1

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const C = {
  violet: { r: 124, g: 58,  b: 237 }, // violet-600 — Total
  blue:   { r: 59,  g: 130, b: 246 }, // blue-500   — Matheus
  pink:   { r: 236, g: 72,  b: 153 }, // pink-500   — Jeniffer
  amber:  { r: 245, g: 158, b: 11  }, // amber-500  — Despesas extras
} as const

function rgba(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface DadosProjecao {
  labels: string[]
  datas:  string[]
  total:    number[]
  matheus:  number[]
  jeniffer: number[]
  extra:    number[]
}

interface Props {
  mesInicio?: Date
  onPontoClicado: (serie: string, mes: string, valor: number, itens: any[]) => void
}

// Gradient fill only for Total dataset
const gradientPlugin = {
  id: 'gradientFillProj',
  beforeDatasetsDraw(chart: any) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const ds = chart.data.datasets[0]
    if (!ds) return
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
    g.addColorStop(0,    rgba(C.violet, 0.22))
    g.addColorStop(0.55, rgba(C.violet, 0.06))
    g.addColorStop(1,    rgba(C.violet, 0))
    ds.backgroundColor = g
  },
}

function makeCrosshair(isDark: boolean) {
  return {
    id: 'crosshairProj',
    afterDatasetsDraw(chart: any) {
      const { ctx, tooltip } = chart
      if (!tooltip?._active?.length) return
      const x = tooltip._active[0].element.x
      const { top, bottom } = chart.chartArea
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, bottom)
      ctx.lineWidth = 1
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.09)'
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.restore()
    },
  }
}

export default function GraficoProjecao({ mesInicio, onPontoClicado }: Props) {
  const [dados, setDados] = useState<DadosProjecao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { theme } = useTheme()
  const [isDark, setIsDark] = useState(false)

  // Refs so the onClick closure never goes stale
  const dadosRef = useRef<DadosProjecao | null>(null)
  const onClickRef = useRef(onPontoClicado)
  useEffect(() => { onClickRef.current = onPontoClicado }, [onPontoClicado])

  useEffect(() => {
    const sync = () =>
      setIsDark(
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      )
    sync()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [theme])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const base  = mesInicio ? startOfMonth(mesInicio) : new Date()
      const inicio = startOfMonth(addMonths(base, PROJECAO_OFFSET_MESES))

      const labels: string[] = []
      const datas:  string[] = []
      for (let i = 0; i < 6; i++) {
        const m = addMonths(inicio, i)
        labels.push(format(m, 'MMM/yy', { locale: ptBR }))
        datas.push(format(startOfMonth(m), 'yyyy-MM-dd'))
      }

      const res = await fetch('/api/projection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meses: labels, inicioStr: datas[0] }),
      })
      if (!res.ok) throw new Error('Falha ao carregar projeção')
      const { total, matheus, jeniffer, extra } = await res.json()

      const d: DadosProjecao = { labels, datas, total, matheus, jeniffer, extra }
      setDados(d)
      dadosRef.current = d
    } catch {
      setErro('Não foi possível carregar a projeção.')
    } finally {
      setCarregando(false)
    }
  }, [mesInicio])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 60_000)
    return () => clearInterval(t)
  }, [carregar])

  const chartData = useMemo(() => {
    if (!dados) return null
    const pBorder = isDark ? '#0f172a' : '#ffffff'

    const mkSecondary = (
      label: string,
      data: number[],
      color: { r: number; g: number; b: number },
      dash?: number[],
    ) => ({
      label,
      data,
      borderColor: rgba(color, 0.82),
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      ...(dash ? { borderDash: dash } : {}),
      tension: 0.42,
      fill: false,
      pointRadius: 2.5,
      pointHoverRadius: 7,
      pointHitRadius: 20,
      pointBackgroundColor: rgba(color),
      pointBorderColor: pBorder,
      pointBorderWidth: 1.5,
      pointHoverBorderWidth: 2,
    })

    return {
      labels: dados.labels,
      datasets: [
        {
          label: 'Total',
          data: dados.total,
          borderColor: rgba(C.violet),
          backgroundColor: 'transparent', // filled by gradientPlugin
          borderWidth: 2.5,
          tension: 0.42,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 10,
          pointHitRadius: 24,
          pointBackgroundColor: rgba(C.violet),
          pointBorderColor: pBorder,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2.5,
        },
        mkSecondary('Matheus',  dados.matheus,  C.blue),
        mkSecondary('Jeniffer', dados.jeniffer, C.pink),
        mkSecondary('Despesas', dados.extra,    C.amber, [5, 4]),
      ],
    }
  }, [dados, isDark])

  const plugins = useMemo(() => [gradientPlugin, makeCrosshair(isDark)], [isDark])

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
          bodyColor: '#94a3b8',
          padding: { top: 10, right: 16, bottom: 10, left: 16 },
          cornerRadius: 12,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: false,
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
      onClick: async (_event: any, elements: any[]) => {
        if (!elements.length) return
        const { datasetIndex, index } = elements[0]
        const d = dadosRef.current
        if (!d) return
        const labels   = ['Total', 'Matheus', 'Jeniffer', 'Despesas']
        const arrays   = [d.total, d.matheus, d.jeniffer, d.extra]
        const serie    = labels[datasetIndex]
        const mes      = d.labels[index]
        const valor    = arrays[datasetIndex]?.[index] ?? 0
        const mesStr   = d.datas[index]
        try {
          const res = await fetch('/api/projection/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serie, mesStr }),
          })
          const { itens } = await res.json()
          onClickRef.current(serie, mes, valor, itens)
        } catch {
          // ignore detail fetch errors silently
        }
      },
    }
  }, [isDark])

  if (carregando) {
    return (
      <div className="h-56 md:h-64 lg:h-72 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (erro) {
    return (
      <div className="h-72 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-8 h-8" />
        <span className="text-sm">{erro}</span>
        <button onClick={carregar} className="text-xs text-blue-500 underline">
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!chartData) return null

  return (
    <div>
      <div className="h-56 md:h-64 lg:h-72">
        <Line data={chartData} options={options} plugins={plugins} />
      </div>
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 mt-3">
        <MousePointerClick className="w-3.5 h-3.5" />
        Toque em um ponto para ver as parcelas do mês
      </p>
    </div>
  )
}
