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
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle, Layers } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { supabase } from '@/lib/supabaseClient'
import { classificarTipoGasto, type AssinaturaAtiva } from '@/lib/composicaoFatura'
import { useIsDark } from '@/lib/useIsDark'
import { CHART_ANIMATION, tooltipCfg, axisColors, legendCfg } from '@/lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MESES_HISTORICO = 6

const COR = {
  existente:  { r: 245, g: 158, b: 11  }, // amber-500 — parcelas de meses anteriores
  assinatura: { r: 20,  g: 184, b: 166 }, // teal-500  — assinaturas recorrentes
  novo:       { r: 124, g: 58,  b: 237 }, // violet-600 — compras novas do mês
} as const

function rgba(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface TransacaoRow {
  valor: number
  responsavel: string | null
  descricao: string | null
  parcela_atual: number | string | null
  total_parcelas: number | string | null
  status: string | null
  projeto_fatura: string
}

interface AssinaturaRow {
  nome: string
  valor: number | null
  responsavel: string
  ativa: boolean
  moeda: string | null
}

interface Dados {
  labels: string[]
  existente: number[]
  assinatura: number[]
  novo: number[]
}

interface Props {
  mesAtual: Date
  ativo?: boolean
}

export default function GraficoComposicaoFatura({ mesAtual, ativo = true }: Props) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()
  const cache = useRef(new Map<string, Dados>())
  const reqId = useRef(0)

  const mesesFatura = useMemo(() => {
    const base = startOfMonth(addMonths(mesAtual, 1))
    return Array.from({ length: MESES_HISTORICO }, (_, i) =>
      format(startOfMonth(subMonths(base, MESES_HISTORICO - 1 - i)), 'yyyy-MM-dd'),
    )
  }, [mesAtual])

  const carregar = useCallback(async () => {
    const id = ++reqId.current
    const chave = mesesFatura[mesesFatura.length - 1]
    const cached = cache.current.get(chave)
    if (cached) setDados(cached)
    else setCarregando(true)
    setErro(null)

    try {
      // 'data_compra' fica fora do select de propósito: no schema legado a coluna
      // chama 'data' e um nome inexistente derruba o SELECT inteiro.
      const [{ data: transacoes, error: erroTx }, { data: assinaturas }] = await Promise.all([
        // Só NuBank: a lista de assinaturas consultada abaixo é do NuBank, então
        // incluir cartão 1/2 classificaria as assinaturas deles como compra nova.
        supabase
          .from('transacoes_nubank')
          .select('valor, responsavel, descricao, parcela_atual, total_parcelas, status, projeto_fatura')
          .eq('cartao', 'nubank')
          .in('projeto_fatura', mesesFatura),
        supabase
          .from('assinaturas')
          .select('nome, valor, responsavel, ativa, moeda')
          .eq('cartao', 'nubank'),
      ])

      if (erroTx) throw erroTx
      if (id !== reqId.current) return

      const assinAtivas: AssinaturaAtiva[] = ((assinaturas ?? []) as AssinaturaRow[])
        .filter(a => a.ativa)
        .map(a => ({ nome: a.nome, responsavel: a.responsavel, valor: a.valor, moeda: a.moeda }))

      const porMes = new Map<string, { existente: number; assinatura: number; novo: number }>()
      for (const mes of mesesFatura) porMes.set(mes, { existente: 0, assinatura: 0, novo: 0 })

      for (const t of ((transacoes ?? []) as TransacaoRow[])) {
        // Estornos e compras estornadas se cancelam; como segmento de barra não
        // fazem sentido — mesma regra usada na composição da fatura do Resumo.
        if (t.status === 'ESTORNO' || t.status === 'ESTORNADO') continue
        const alvo = porMes.get(t.projeto_fatura)
        if (!alvo) continue
        const tipo = classificarTipoGasto(
          t.descricao,
          t.parcela_atual == null ? null : Number(t.parcela_atual),
          t.total_parcelas == null ? null : Number(t.total_parcelas),
          t.responsavel,
          assinAtivas,
          t.valor,
        )
        alvo[tipo] += Number(t.valor ?? 0)
      }

      const entry: Dados = {
        labels: mesesFatura.map(m => format(new Date(m + 'T12:00:00'), 'MMM/yy', { locale: ptBR })),
        existente:  mesesFatura.map(m => porMes.get(m)?.existente  ?? 0),
        assinatura: mesesFatura.map(m => porMes.get(m)?.assinatura ?? 0),
        novo:       mesesFatura.map(m => porMes.get(m)?.novo       ?? 0),
      }

      cache.current.set(chave, entry)
      if (cache.current.size > 12) {
        const oldest = cache.current.keys().next().value
        if (oldest) cache.current.delete(oldest)
      }
      setDados(entry)
    } catch {
      if (id === reqId.current) setErro('Não foi possível carregar a composição das faturas.')
    } finally {
      if (id === reqId.current) setCarregando(false)
    }
  }, [mesesFatura])

  useEffect(() => {
    if (!ativo) return
    carregar()
  }, [carregar, ativo])

  const chartData = useMemo(() => {
    if (!dados) return null
    const alpha = isDark ? 0.85 : 0.8
    const base = {
      borderRadius: 4,
      borderSkipped: false as const,
      maxBarThickness: 34,
      stack: 'fatura',
    }
    return {
      labels: dados.labels,
      datasets: [
        {
          ...base,
          label: 'Parcelas anteriores',
          data: dados.existente,
          backgroundColor: rgba(COR.existente, alpha),
          hoverBackgroundColor: rgba(COR.existente, 1),
        },
        {
          ...base,
          label: 'Assinaturas',
          data: dados.assinatura,
          backgroundColor: rgba(COR.assinatura, alpha),
          hoverBackgroundColor: rgba(COR.assinatura, 1),
        },
        {
          ...base,
          label: 'Compras novas',
          data: dados.novo,
          backgroundColor: rgba(COR.novo, alpha),
          hoverBackgroundColor: rgba(COR.novo, 1),
        },
      ],
    }
  }, [dados, isDark])

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
            label: (ctx: TooltipItem<'bar'>) => {
              const i = ctx.dataIndex
              const total = (dados?.existente[i] ?? 0) + (dados?.assinatura[i] ?? 0) + (dados?.novo[i] ?? 0)
              const v = ctx.parsed.y ?? 0
              const pct = total > 0 ? ` (${((v / total) * 100).toFixed(0)}%)` : ''
              return `  ${ctx.dataset.label}: ${formatBRL(v)}${pct}`
            },
            footer: (items: TooltipItem<'bar'>[]) => {
              const i = items[0]?.dataIndex ?? -1
              if (i < 0 || !dados) return ''
              const total = dados.existente[i] + dados.assinatura[i] + dados.novo[i]
              return `Total: ${formatBRL(total)}`
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 10 }, color: txt },
        },
        y: {
          stacked: true,
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

  const temDados = dados
    ? dados.existente.some(v => v > 0) || dados.assinatura.some(v => v > 0) || dados.novo.some(v => v > 0)
    : false

  if (!dados || !chartData || !temDados) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-center px-4">
        <Layers className="w-8 h-8 opacity-30" />
        <span className="text-sm">Nenhuma compra importada nos últimos meses</span>
      </div>
    )
  }

  const ultimo = dados.labels.length - 1
  const totalUltimo = dados.existente[ultimo] + dados.assinatura[ultimo] + dados.novo[ultimo]
  const comprometido = dados.existente[ultimo] + dados.assinatura[ultimo]
  const pctComprometido = totalUltimo > 0 ? (comprometido / totalUltimo) * 100 : 0

  return (
    <div>
      <div className="h-56 md:h-64 lg:h-72">
        <Bar data={chartData} options={options} />
      </div>

      {totalUltimo > 0 && (
        <p className="text-[11px] text-gray-400 mt-3 leading-snug">
          Na fatura de {dados.labels[ultimo]},{' '}
          <span className={`font-semibold ${pctComprometido >= 60 ? 'text-amber-600' : 'text-gray-500'}`}>
            {pctComprometido.toFixed(0)}%
          </span>{' '}
          já estava comprometido antes do mês começar (parcelas anteriores + assinaturas).
        </p>
      )}
    </div>
  )
}
