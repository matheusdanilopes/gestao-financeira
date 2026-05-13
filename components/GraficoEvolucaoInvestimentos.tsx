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
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle, PiggyBank } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useTheme } from '@/components/ThemeProvider'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

const MESES = 6

const VIOLET = { r: 139, g: 92,  b: 246 } // violet-500 — realizado
const TEAL   = { r: 20,  g: 184, b: 166 } // teal-500   — meta

function rgb(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface DadosInvestimento {
  labels: string[]
  realizado: (number | null)[] // null para meses futuros
  meta: number[]
}

interface Props {
  mesAtual: Date
}

const gradientPlugin = {
  id: 'gradientFillInv',
  beforeDatasetsDraw(chart: any) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const ds = chart.data.datasets[0]
    if (!ds) return
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
    g.addColorStop(0,   rgb(VIOLET, 0.22))
    g.addColorStop(0.6, rgb(VIOLET, 0.05))
    g.addColorStop(1,   rgb(VIOLET, 0))
    ds.backgroundColor = g
  },
}

function makeCrosshair(isDark: boolean) {
  return {
    id: 'crosshairInv',
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
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)'
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.restore()
    },
  }
}

export default function GraficoEvolucaoInvestimentos({ mesAtual }: Props) {
  const [dados, setDados] = useState<DadosInvestimento | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { theme } = useTheme()
  const [isDark, setIsDark] = useState(false)

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
    setErro(null)
    try {
      const hojeRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')

      const mesesRef: string[] = []
      for (let i = MESES - 1; i >= 0; i--)
        mesesRef.push(format(startOfMonth(subMonths(mesAtual, i)), 'yyyy-MM-dd'))

      const inicioPeriodo = mesesRef[0]
      const fimPeriodo = format(endOfMonth(mesAtual), 'yyyy-MM-dd')

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

      // Aportes realizados por mês
      const aportesMap = new Map<string, number>()
      for (const a of (aportes || [])) {
        const mes = format(startOfMonth(new Date(a.data_aporte + 'T12:00:00')), 'yyyy-MM-dd')
        aportesMap.set(mes, (aportesMap.get(mes) || 0) + a.valor)
      }

      // Percentual total de investimento por mês
      const pctMap = new Map<string, number>()
      for (const iv of (invPlano || [])) {
        const mes: string = iv.mes_referencia
        pctMap.set(mes, (pctMap.get(mes) || 0) + iv.percentual)
      }

      // Receita e despesas por mês (para calcular a meta)
      const recMap = new Map<string, number>()
      const desMap = new Map<string, number>()
      for (const p of (plan || [])) {
        const mes: string = p.mes_referencia
        const item = String(p.item || '')
        const isPast = mes < hojeRef
        const valor =
          isPast && p.pago && p.valor_real != null ? p.valor_real : (p.valor_previsto || 0)
        if (item === 'Receita Total' || item.startsWith('[RECEITA]'))
          recMap.set(mes, (recMap.get(mes) || 0) + valor)
        else
          desMap.set(mes, (desMap.get(mes) || 0) + valor)
      }

      const realizado: (number | null)[] = []
      const meta: number[] = []

      for (const mes of mesesRef) {
        const isFuturo = mes > hojeRef
        realizado.push(isFuturo ? null : (aportesMap.get(mes) || 0))

        const pct = pctMap.get(mes) || 0
        const saldo = (recMap.get(mes) || 0) - (desMap.get(mes) || 0)
        meta.push(pct > 0 && saldo > 0 ? (saldo * pct) / 100 : 0)
      }

      setDados({
        labels: mesesRef.map(m =>
          format(new Date(m + 'T12:00:00'), 'MMM/yy', { locale: ptBR })
        ),
        realizado,
        meta,
      })
    } catch {
      setErro('Não foi possível carregar a evolução de investimentos.')
    } finally {
      setCarregando(false)
    }
  }, [mesAtual])

  useEffect(() => {
    setCarregando(true)
    carregar()
    const t = setInterval(carregar, 60_000)
    return () => clearInterval(t)
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
          borderColor: rgb(VIOLET),
          backgroundColor: 'transparent', // preenchido pelo gradientPlugin
          borderWidth: 2.5,
          tension: 0.42,
          fill: true,
          spanGaps: false,
          pointRadius: dados.realizado.map(v => (v !== null ? 4 : 0)),
          pointHoverRadius: 9,
          pointHitRadius: 24,
          pointBackgroundColor: rgb(VIOLET),
          pointBorderColor: pBorder,
          pointBorderWidth: 2.5,
          pointHoverBorderWidth: 2.5,
        },
        {
          label: 'Meta',
          data: dados.meta,
          borderColor: rgb(TEAL, 0.75),
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [6, 4],
          tension: 0.42,
          fill: false,
          spanGaps: true,
          pointRadius: 0,
          pointHoverRadius: 7,
          pointHitRadius: 24,
          pointBackgroundColor: rgb(TEAL),
          pointBorderColor: pBorder,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2,
        },
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
          usePointStyle: true,
          callbacks: {
            title: (items: any[]) => items[0]?.label ?? '',
            label: (ctx: any) =>
              ctx.parsed.y === null
                ? `  ${ctx.dataset.label}: —`
                : `  ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`,
          },
        },
        datalabels: { display: false },
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

  if (carregando) {
    return (
      <div className="h-56 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (erro) {
    return (
      <div className="h-56 flex flex-col items-center justify-center gap-3 text-red-400">
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

  const hasData =
    dados !== null &&
    (dados.realizado.some(v => v !== null && v > 0) || dados.meta.some(v => v > 0))

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

  const temFuturo = dados.realizado.some(v => v === null)

  return (
    <div>
      <div className="h-56 md:h-64 lg:h-72">
        <Line data={chartData} options={options} plugins={plugins} />
      </div>

      <p className="flex items-center justify-center gap-5 text-[11px] text-gray-400 mt-3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-0.5 rounded-full bg-violet-400" />
          Realizado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t border-dashed border-teal-400" />
          {temFuturo ? 'Meta / Projeção' : 'Meta'}
        </span>
      </p>
    </div>
  )
}
