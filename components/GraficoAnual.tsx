'use client'

import { useEffect, useMemo, useState } from 'react'
import { Chart } from 'react-chartjs-2'
import type { ChartData } from 'chart.js'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'
import { CHART_ANIMATION, tooltipCfg, axisColors } from '@/lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend)

interface PlanejamentoRow {
  mes_referencia: string
  item: string
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
}

interface MonthData {
  receita: number
  despesas: number
  saldo: number
}

interface Props {
  ano: number
}

function isReceitaItem(item: string): boolean {
  return item === 'Receita Total' || item.startsWith('[RECEITA]')
}

export default function GraficoAnual({ ano }: Props) {
  const [monthData, setMonthData] = useState<MonthData[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()

  useEffect(() => {
    let cancelled = false

    async function carregar() {
      setCarregando(true)
      setErro(null)
      try {
        const { data, error } = await supabase
          .from('planejamento')
          .select('mes_referencia, item, valor_previsto, valor_real, pago')
          .gte('mes_referencia', `${ano}-01-01`)
          .lte('mes_referencia', `${ano}-12-31`)

        if (error) throw error
        if (cancelled) return

        const rows: PlanejamentoRow[] = data ?? []

        // Build per-month maps
        const receitaByMonth = new Map<string, number>()
        const despesasPagosByMonth = new Map<string, number>()
        const despesasPrevistosByMonth = new Map<string, number>()

        for (const row of rows) {
          const mes = row.mes_referencia.slice(0, 7) // "YYYY-MM"
          const item = String(row.item ?? '')
          const previsto = row.valor_previsto ?? 0
          const real = row.valor_real ?? 0
          const pago = Boolean(row.pago)

          if (isReceitaItem(item)) {
            receitaByMonth.set(mes, (receitaByMonth.get(mes) ?? 0) + previsto)
          } else {
            if (pago) {
              despesasPagosByMonth.set(mes, (despesasPagosByMonth.get(mes) ?? 0) + real)
            }
            despesasPrevistosByMonth.set(mes, (despesasPrevistosByMonth.get(mes) ?? 0) + previsto)
          }
        }

        const newLabels: string[] = []
        const newData: MonthData[] = []

        for (let m = 1; m <= 12; m++) {
          const mesKey = `${ano}-${String(m).padStart(2, '0')}`
          const date = new Date(ano, m - 1, 1)
          const label = format(date, 'MMM', { locale: ptBR })
          newLabels.push(label.charAt(0).toUpperCase() + label.slice(1))

          const receita = receitaByMonth.get(mesKey) ?? 0
          const paidDespesas = despesasPagosByMonth.get(mesKey) ?? 0
          const prevDespesas = despesasPrevistosByMonth.get(mesKey) ?? 0
          const despesas = paidDespesas > 0 ? paidDespesas : prevDespesas
          const saldo = receita - despesas

          newData.push({ receita, despesas, saldo })
        }

        setLabels(newLabels)
        setMonthData(newData)
      } catch {
        if (!cancelled) setErro('Não foi possível carregar os dados anuais.')
      } finally {
        if (!cancelled) setCarregando(false)
      }
    }

    carregar()
    return () => { cancelled = true }
  }, [ano])

  const { txt, grid } = axisColors(isDark)

  const chartData = useMemo(() => ({
    labels,
    datasets: [
      {
        type: 'bar' as const,
        label: 'Receita',
        data: monthData.map((d: MonthData) => d.receita),
        backgroundColor: 'rgba(16,185,129,0.6)',
        borderColor: 'rgb(16,185,129)',
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 32,
      },
      {
        type: 'bar' as const,
        label: 'Despesas',
        data: monthData.map((d: MonthData) => d.despesas),
        backgroundColor: 'rgba(239,68,68,0.55)',
        borderColor: 'rgb(239,68,68)',
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 32,
      },
      {
        type: 'line' as const,
        label: 'Saldo',
        data: monthData.map((d: MonthData) => d.saldo),
        borderColor: 'rgb(139,92,246)',
        backgroundColor: 'rgba(139,92,246,0.1)',
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.35,
        fill: false,
        yAxisID: 'y',
      },
    ],
  }), [labels, monthData])

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          font: { size: 11 },
          usePointStyle: true,
          boxHeight: 6,
          color: txt,
        },
      },
      tooltip: {
        ...tooltipCfg(isDark),
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
            `  ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: txt },
      },
      y: {
        grid: { color: grid, lineWidth: 1 },
        ticks: {
          callback: (v: number | string) => `R$${(Number(v) / 1000).toFixed(0)}k`,
          font: { size: 10 },
          color: txt,
          maxTicksLimit: 5,
        },
      },
    },
  }), [isDark, txt, grid])

  const totalReceita = monthData.reduce((s: number, d: MonthData) => s + d.receita, 0)
  const totalDespesas = monthData.reduce((s: number, d: MonthData) => s + d.despesas, 0)
  const totalSaldo = totalReceita - totalDespesas

  if (carregando) {
    return <div className="h-64 animate-pulse bg-gray-100 rounded-2xl" />
  }

  if (erro) {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button
          onClick={() => { setCarregando(true); setErro(null) }}
          className="text-xs text-primary-500 hover:text-primary-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="h-64">
        <Chart type="bar" data={chartData as ChartData<'bar'>} options={options} />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Receita anual</p>
          <p className="text-sm font-bold text-emerald-600 num">{formatBRL(totalReceita)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Despesas anuais</p>
          <p className="text-sm font-bold text-red-500 num">{formatBRL(totalDespesas)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Saldo anual</p>
          <p className={`text-sm font-bold num ${totalSaldo >= 0 ? 'text-violet-600' : 'text-red-500'}`}>
            {formatBRL(totalSaldo)}
          </p>
        </div>
      </div>
    </div>
  )
}
