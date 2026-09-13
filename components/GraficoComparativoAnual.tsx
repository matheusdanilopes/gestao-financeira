'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'
import type { TooltipItem } from 'chart.js'
import { AlertCircle, CalendarRange } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'
import { CHART_ANIMATION, tooltipCfg, axisColors, legendCfg } from '@/lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const COR_ATUAL    = { r: 99,  g: 102, b: 241 } // indigo-500
const COR_ANTERIOR = { r: 148, g: 163, b: 184 } // slate-400

function rgba(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface PlanejamentoRow {
  mes_referencia: string
  item: string
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
}

interface Dados {
  /** Despesas por mês (índice 0 = janeiro); null = mês sem lançamento */
  atual: (number | null)[]
  anterior: (number | null)[]
  /** Total dos meses já decorridos, nos dois anos — base da comparação justa */
  totalAtualParcial: number
  totalAnteriorParcial: number
  /** Último mês (1-12) considerado na comparação parcial */
  mesLimite: number
}

interface Props {
  ano: number
  ativo?: boolean
}

function ehReceita(item: string): boolean {
  return item === 'Receita Total' || item.startsWith('[RECEITA]')
}

export default function GraficoComparativoAnual({ ano, ativo = true }: Props) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()
  const reqId = useRef(0)

  const carregar = useCallback(async () => {
    const id = ++reqId.current
    setCarregando(true)
    setErro(null)
    try {
      const { data, error } = await supabase
        .from('planejamento')
        .select('mes_referencia, item, valor_previsto, valor_real, pago')
        .gte('mes_referencia', `${ano - 1}-01-01`)
        .lte('mes_referencia', `${ano}-12-31`)

      if (error) throw error
      if (id !== reqId.current) return

      // Mesma regra da Visão Anual: mês pago usa o real, senão o previsto.
      const pagoPorMes = new Map<string, number>()
      const previstoPorMes = new Map<string, number>()
      const mesesComLancamento = new Set<string>()

      for (const row of (data ?? []) as PlanejamentoRow[]) {
        const mes = row.mes_referencia.slice(0, 7)
        mesesComLancamento.add(mes)
        if (ehReceita(String(row.item ?? ''))) continue
        if (row.pago) pagoPorMes.set(mes, (pagoPorMes.get(mes) ?? 0) + (row.valor_real ?? 0))
        previstoPorMes.set(mes, (previstoPorMes.get(mes) ?? 0) + (row.valor_previsto ?? 0))
      }

      const despesaDoMes = (anoAlvo: number, mes: number): number | null => {
        const chave = `${anoAlvo}-${String(mes).padStart(2, '0')}`
        if (!mesesComLancamento.has(chave)) return null
        const pago = pagoPorMes.get(chave) ?? 0
        return pago > 0 ? pago : (previstoPorMes.get(chave) ?? 0)
      }

      const atual    = Array.from({ length: 12 }, (_, i) => despesaDoMes(ano, i + 1))
      const anterior = Array.from({ length: 12 }, (_, i) => despesaDoMes(ano - 1, i + 1))

      // Comparar o ano inteiro contra um ano em andamento infla a diferença;
      // a leitura honesta é "mesmo período nos dois anos".
      const hoje = new Date()
      const mesLimite = ano === hoje.getFullYear() ? hoje.getMonth() + 1 : 12
      const somaAte = (serie: (number | null)[]) =>
        serie.slice(0, mesLimite).reduce<number>((s, v) => s + (v ?? 0), 0)

      setDados({
        atual,
        anterior,
        totalAtualParcial: somaAte(atual),
        totalAnteriorParcial: somaAte(anterior),
        mesLimite,
      })
    } catch {
      if (id === reqId.current) setErro('Não foi possível comparar os anos.')
    } finally {
      if (id === reqId.current) setCarregando(false)
    }
  }, [ano])

  useEffect(() => {
    if (!ativo) return
    carregar()
  }, [carregar, ativo])

  const chartData = useMemo(() => {
    if (!dados) return null
    return {
      labels: MESES,
      datasets: [
        {
          label: String(ano - 1),
          data: dados.anterior,
          backgroundColor: rgba(COR_ANTERIOR, isDark ? 0.35 : 0.4),
          hoverBackgroundColor: rgba(COR_ANTERIOR, 0.7),
          borderRadius: 4,
          borderSkipped: false as const,
          maxBarThickness: 18,
        },
        {
          label: String(ano),
          data: dados.atual,
          backgroundColor: rgba(COR_ATUAL, isDark ? 0.85 : 0.8),
          hoverBackgroundColor: rgba(COR_ATUAL, 1),
          borderRadius: 4,
          borderSkipped: false as const,
          maxBarThickness: 18,
        },
      ],
    }
  }, [dados, isDark, ano])

  const options = useMemo(() => {
    const { txt, grid } = axisColors(isDark)
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIMATION,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: legendCfg(isDark),
        tooltip: {
          ...tooltipCfg(isDark),
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          callbacks: {
            label: (ctx: TooltipItem<'bar'>) =>
              ctx.parsed.y == null ? '' : `  ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`,
            afterBody: (items: TooltipItem<'bar'>[]) => {
              const i = items[0]?.dataIndex ?? -1
              if (i < 0 || !dados) return []
              const a = dados.anterior[i]
              const b = dados.atual[i]
              if (a == null || b == null || a === 0) return []
              const variacao = ((b - a) / a) * 100
              return ['', `  Variação: ${variacao >= 0 ? '+' : ''}${variacao.toFixed(1)}%`]
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 10 }, color: txt },
        },
        y: {
          grid: { color: grid, lineWidth: 1 },
          border: { display: false },
          ticks: {
            callback: (v: number | string) => {
              const n = Number(v)
              if (n === 0) return 'R$0'
              return n >= 1000 ? `R$${(n / 1000).toFixed(0)}k` : `R$${n.toFixed(0)}`
            },
            font: { size: 10 },
            color: txt,
            maxTicksLimit: 5,
          },
        },
      },
    }
  }, [isDark, dados])

  if (carregando && !dados) {
    return <div className="h-64 skeleton rounded-2xl" />
  }

  if (erro) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button
          onClick={carregar}
          className="text-xs text-primary-500 hover:text-primary-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!dados || !chartData) return null

  const semAnterior = dados.anterior.every(v => v == null)
  if (semAnterior) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-center px-4">
        <CalendarRange className="w-8 h-8 opacity-30" />
        <span className="text-sm">Sem planejamento registrado em {ano - 1}</span>
        <span className="text-xs">A comparação aparece quando houver dois anos de histórico</span>
      </div>
    )
  }

  const delta = dados.totalAtualParcial - dados.totalAnteriorParcial
  const pct = dados.totalAnteriorParcial > 0
    ? (delta / dados.totalAnteriorParcial) * 100
    : null

  return (
    <div>
      <div className="flex items-end justify-between mb-4 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
            {ano} até {MESES[dados.mesLimite - 1]}
          </p>
          <p className="text-xl font-bold text-gray-700 num leading-none">
            {formatBRL(dados.totalAtualParcial)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
            vs. {ano - 1}
          </p>
          <p className={`text-sm font-bold num leading-none ${delta > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {delta >= 0 ? '+' : '−'}{formatBRL(Math.abs(delta))}
            {pct !== null && (
              <span className="font-semibold text-[11px] ml-1">
                ({pct >= 0 ? '+' : ''}{pct.toFixed(0)}%)
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="h-56 md:h-64">
        <Bar data={chartData} options={options} />
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        Comparação do total considera apenas janeiro a {MESES[dados.mesLimite - 1].toLowerCase()} nos dois anos.
      </p>
    </div>
  )
}
