'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useTheme } from '@/components/ThemeProvider'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const MESES_HISTORICO = 6

interface EvolucaoMensal {
  labels: string[]
  receitas: number[]
  despesas: number[]
  investimentos: number[]
}

interface Props {
  mesAtual: Date
}

export default function GraficoEvolucaoMensal({ mesAtual }: Props) {
  const [dados, setDados] = useState<EvolucaoMensal | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { theme } = useTheme()
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const atualizar = () => {
      setIsDark(
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      )
    }
    atualizar()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', atualizar)
    return () => mq.removeEventListener('change', atualizar)
  }, [theme])

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const mesesRef: string[] = []
      for (let i = MESES_HISTORICO - 1; i >= 0; i--) {
        mesesRef.push(format(startOfMonth(subMonths(mesAtual, i)), 'yyyy-MM-dd'))
      }

      const fimPeriodo = format(endOfMonth(mesAtual), 'yyyy-MM-dd')

      const [{ data: planejamento }, { data: aportes }] = await Promise.all([
        supabase
          .from('planejamento')
          .select('item, valor_previsto, valor_real, pago, mes_referencia')
          .in('mes_referencia', mesesRef),
        supabase
          .from('investimentos_aportes')
          .select('valor, data_aporte')
          .gte('data_aporte', mesesRef[0])
          .lte('data_aporte', fimPeriodo),
      ])

      const receitasPorMes = new Map<string, number>()
      const despesasPorMes = new Map<string, number>()

      for (const p of (planejamento || [])) {
        const mes: string = p.mes_referencia
        const item = String(p.item || '')
        const valor = p.pago && p.valor_real != null ? p.valor_real : (p.valor_previsto || 0)

        if (item === 'Receita Total' || item.startsWith('[RECEITA]')) {
          receitasPorMes.set(mes, (receitasPorMes.get(mes) || 0) + valor)
        } else {
          despesasPorMes.set(mes, (despesasPorMes.get(mes) || 0) + valor)
        }
      }

      const investimentosPorMes = new Map<string, number>()
      for (const a of (aportes || [])) {
        // data_aporte can be 'yyyy-MM-dd' — parse as local noon to avoid timezone shifts
        const mes = format(startOfMonth(new Date(a.data_aporte + 'T12:00:00')), 'yyyy-MM-dd')
        investimentosPorMes.set(mes, (investimentosPorMes.get(mes) || 0) + a.valor)
      }

      setDados({
        labels: mesesRef.map(m =>
          format(new Date(m + 'T12:00:00'), "MMM/yy", { locale: ptBR })
        ),
        receitas: mesesRef.map(m => receitasPorMes.get(m) || 0),
        despesas: mesesRef.map(m => despesasPorMes.get(m) || 0),
        investimentos: mesesRef.map(m => investimentosPorMes.get(m) || 0),
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
    const intervalo = setInterval(carregar, 60_000)
    return () => clearInterval(intervalo)
  }, [carregar])

  const chartData = useMemo(() => {
    if (!dados) return null
    const pointBorder = isDark ? '#111827' : '#ffffff'
    return {
      labels: dados.labels,
      datasets: [
        {
          label: 'Receitas',
          data: dados.receitas,
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          borderWidth: 2.5,
          tension: 0.4,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgb(16, 185, 129)',
          pointBorderColor: pointBorder,
          pointBorderWidth: 2,
        },
        {
          label: 'Despesas',
          data: dados.despesas,
          borderColor: 'rgb(239, 68, 68)',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderWidth: 2.5,
          tension: 0.4,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgb(239, 68, 68)',
          pointBorderColor: pointBorder,
          pointBorderWidth: 2,
        },
        {
          label: 'Investimentos',
          data: dados.investimentos,
          borderColor: 'rgb(139, 92, 246)',
          backgroundColor: 'rgba(139, 92, 246, 0.08)',
          borderWidth: 2.5,
          tension: 0.4,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgb(139, 92, 246)',
          pointBorderColor: pointBorder,
          pointBorderWidth: 2,
        },
      ],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    const textColor = isDark ? '#9ca3af' : '#6b7280'
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
    const tooltipBg = isDark ? 'rgba(31,41,55,0.97)' : 'rgba(17,24,39,0.92)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: { duration: 500, easing: 'easeInOutQuart' as const },
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: {
            font: { size: 12 },
            boxWidth: 10,
            boxHeight: 10,
            padding: 20,
            usePointStyle: true,
            pointStyleWidth: 10,
            color: textColor,
          },
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: '#f9fafb',
          bodyColor: '#d1d5db',
          padding: 12,
          cornerRadius: 10,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)',
          borderWidth: 1,
          callbacks: {
            label: (ctx: any) => ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`,
          },
        },
        datalabels: { display: false },
      },
      scales: {
        y: {
          ticks: {
            callback: (value: any) => formatBRL(Number(value)),
            font: { size: 10 },
            maxTicksLimit: 6,
            color: textColor,
          },
          grid: { color: gridColor },
          border: { display: false },
        },
        x: {
          ticks: { font: { size: 11 }, color: textColor },
          grid: { display: false },
          border: { display: false },
        },
      },
    }
  }, [isDark])

  if (carregando) {
    return (
      <div className="h-64 md:h-72 flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />
        <span className="text-sm">Carregando evolução…</span>
      </div>
    )
  }

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

  return (
    <div className="h-64 md:h-72 lg:h-80">
      <Line data={chartData} options={options} />
    </div>
  )
}
