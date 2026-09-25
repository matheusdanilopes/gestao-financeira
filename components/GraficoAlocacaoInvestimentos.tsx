'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js'
import type { TooltipItem } from 'chart.js'
import { format, startOfMonth } from 'date-fns'
import { AlertCircle, PiggyBank } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'
import { CHART_ANIMATION, tooltipCfg } from '@/lib/chartTheme'

ChartJS.register(ArcElement, Tooltip)

const CORES = [
  '#7c3aed', '#3b82f6', '#14b8a6', '#f59e0b',
  '#ec4899', '#10b981', '#6366f1', '#f97316',
]

interface InvestimentoRow {
  id: string
  descricao: string
  percentual: number
  investimentos_aportes?: { valor: number }[] | null
}

interface Fatia {
  descricao: string
  aportado: number
  percentualMeta: number
  cor: string
}

interface Props {
  mesAtual: Date
  ativo?: boolean
}

export default function GraficoAlocacaoInvestimentos({ mesAtual, ativo = true }: Props) {
  const [fatias, setFatias] = useState<Fatia[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()
  const reqId = useRef(0)

  const mesRef = useMemo(() => format(startOfMonth(mesAtual), 'yyyy-MM-dd'), [mesAtual])

  const carregar = useCallback(async () => {
    const id = ++reqId.current
    setCarregando(true)
    setErro(null)
    try {
      const { data, error } = await supabase
        .from('investimentos')
        .select('id, descricao, percentual, investimentos_aportes(valor)')
        .eq('mes_referencia', mesRef)
        .order('created_at', { ascending: true })

      if (error) throw error
      if (id !== reqId.current) return

      const linhas = (data ?? []) as InvestimentoRow[]
      setFatias(
        linhas.map((inv, i) => ({
          descricao: inv.descricao,
          aportado: (inv.investimentos_aportes ?? []).reduce((s, a) => s + Number(a.valor ?? 0), 0),
          percentualMeta: Number(inv.percentual ?? 0),
          cor: CORES[i % CORES.length],
        })),
      )
    } catch {
      if (id === reqId.current) setErro('Não foi possível carregar a alocação.')
    } finally {
      if (id === reqId.current) setCarregando(false)
    }
  }, [mesRef])

  useEffect(() => {
    if (!ativo) return
    carregar()
  }, [carregar, ativo])

  const totalAportado = (fatias ?? []).reduce((s, f) => s + f.aportado, 0)
  // Sem nenhum aporte no mês, o rosca cai para a alocação-alvo (percentual
  // configurado), que é a única informação disponível — e fica dito no rodapé.
  const modoMeta = totalAportado === 0

  const chartData = useMemo(() => {
    if (!fatias?.length) return null
    const valores = modoMeta ? fatias.map(f => f.percentualMeta) : fatias.map(f => f.aportado)
    if (valores.every(v => v === 0)) return null
    return {
      labels: fatias.map(f => f.descricao),
      datasets: [
        {
          data: valores,
          backgroundColor: fatias.map(f => f.cor),
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    }
  }, [fatias, modoMeta])

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: CHART_ANIMATION,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipCfg(isDark),
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          callbacks: {
            label: (ctx: TooltipItem<'doughnut'>) => {
              const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0)
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1).replace('.', ',') : '0'
              return modoMeta
                ? `  ${ctx.parsed.toFixed(1).replace('.', ',')}% da meta (${pct}% do plano)`
                : `  ${formatBRL(ctx.parsed)} (${pct}%)`
            },
          },
        },
      },
    }),
    [isDark, modoMeta],
  )

  if (carregando && !fatias) {
    return <div className="h-56 skeleton rounded-2xl" />
  }

  if (erro) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button
          onClick={carregar}
          className="text-xs text-violet-500 hover:text-violet-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!fatias?.length || !chartData) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-center px-4">
        <PiggyBank className="w-8 h-8 opacity-30" />
        <span className="text-sm">Nenhum investimento configurado neste mês</span>
        <a href="/investimentos" className="text-xs text-violet-500 underline">
          Configurar investimentos
        </a>
      </div>
    )
  }

  const totalMeta = fatias.reduce((s, f) => s + f.percentualMeta, 0)

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative h-40 w-40 shrink-0">
          <Doughnut data={chartData} options={options} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest">
              {modoMeta ? 'Meta' : 'Aportado'}
            </span>
            <span className="text-sm font-bold text-gray-700 num">
              {modoMeta ? `${totalMeta.toFixed(0)}%` : formatBRL(totalAportado)}
            </span>
          </div>
        </div>

        <ul className="flex-1 min-w-0 flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-0.5">
          {fatias.map(f => (
            <li key={f.descricao} className="flex items-center gap-2 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: f.cor }}
              />
              <span className="text-[11px] text-gray-600 truncate flex-1">{f.descricao}</span>
              <span className="text-[11px] font-semibold text-gray-500 num shrink-0">
                {modoMeta ? `${f.percentualMeta.toFixed(0)}%` : formatBRL(f.aportado)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        {modoMeta
          ? `Nenhum aporte registrado no mês — exibindo a alocação-alvo (${totalMeta.toFixed(0)}% do saldo).`
          : `Divisão dos aportes já registrados entre os investimentos do mês.`}
      </p>
    </div>
  )
}
