'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import type { TooltipItem } from 'chart.js'
import { addMonths, format, startOfMonth } from 'date-fns'
import { AlertCircle, BarChart3 } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const NUBANK_ITEMS = new Set(['NuBank Matheus', 'NuBank Jeniffer', 'NuBank Jeniffer Conjunto'])
const MAX_CATS = 12
const BAR_MIN_W = 64 // px per bar — ensures readability on mobile

const PALETTE = [
  [99,  102, 241] as const, // indigo-500
  [139, 92,  246] as const, // violet-500
  [59,  130, 246] as const, // blue-500
  [236, 72,  153] as const, // pink-500
  [16,  185, 129] as const, // emerald-500
  [245, 158, 11 ] as const, // amber-500
  [6,   182, 212] as const, // cyan-500
  [249, 115, 22 ] as const, // orange-500
  [239, 68,  68 ] as const, // red-500
  [20,  184, 166] as const, // teal-500
  [168, 85,  247] as const, // purple-500
  [34,  197, 94 ] as const, // green-500
]

function rgba(c: readonly [number, number, number], a = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

interface CategoryData {
  label: string
  valor: number
  contagem: number
  pct: number
}

interface Props {
  mesAtual: Date
}

type CacheEntry = { categorias: CategoryData[] }

export default function GraficoCategoriasDespesas({ mesAtual }: Props) {
  const [dados, setDados] = useState<CacheEntry | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()
  const cache = useRef(new Map<string, CacheEntry>())

  const carregar = useCallback(async () => {
    const mesKey = format(mesAtual, 'yyyy-MM')
    const cached = cache.current.get(mesKey)
    if (cached) {
      setDados(cached)
    } else {
      setCarregando(true)
    }
    setErro(null)

    try {
      const mesRefFatura = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')
      const mesRefAtual = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

      const [{ data: transacoes }, { data: plan }] = await Promise.all([
        supabase
          .from('transacoes_nubank')
          .select('valor, categoria, cartao')
          .eq('projeto_fatura', mesRefFatura),
        supabase
          .from('planejamento')
          .select('item, valor_previsto, valor_real, pago, categoria')
          .eq('mes_referencia', mesRefAtual),
      ])

      // Which cartões have real imported transactions this month
      const hasNubank  = (transacoes ?? []).some(t => !t.cartao || t.cartao === 'nubank')
      const hasCartao1 = (transacoes ?? []).some(t => t.cartao === 'cartao1')
      const hasCartao2 = (transacoes ?? []).some(t => t.cartao === 'cartao2')

      const catMap = new Map<string, { valor: number; contagem: number }>()

      function add(cat: string, valor: number) {
        if (valor <= 0) return
        const e = catMap.get(cat) ?? { valor: 0, contagem: 0 }
        e.valor += valor
        e.contagem++
        catMap.set(cat, e)
      }

      // Real transactions — highest priority
      for (const t of (transacoes ?? [])) {
        add(t.categoria || 'Sem categoria', t.valor)
      }

      // Planned items — only for expenses without real data
      for (const p of (plan ?? [])) {
        const item = String(p.item ?? '')
        if (item === 'Receita Total' || item.startsWith('[RECEITA]')) continue
        if (hasNubank  && NUBANK_ITEMS.has(item))       continue
        if (hasCartao1 && item.startsWith('[CARTAO1]')) continue
        if (hasCartao2 && item.startsWith('[CARTAO2]')) continue
        // Real value (paid) → fallback to planned
        const valor = p.pago && p.valor_real != null ? Number(p.valor_real) : Number(p.valor_previsto ?? 0)
        add(p.categoria || 'Outros', valor)
      }

      const total = [...catMap.values()].reduce((s, e) => s + e.valor, 0)
      const sorted = [...catMap.entries()]
        .sort(([, a], [, b]) => b.valor - a.valor)
        .slice(0, MAX_CATS)

      const categorias: CategoryData[] = sorted.map(([label, { valor, contagem }]) => ({
        label,
        valor,
        contagem,
        pct: total > 0 ? (valor / total) * 100 : 0,
      }))

      const entry: CacheEntry = { categorias }
      cache.current.set(mesKey, entry)
      if (cache.current.size > 12) {
        const oldest = cache.current.keys().next().value
        if (oldest) cache.current.delete(oldest)
      }
      setDados(entry)
    } catch {
      setErro('Não foi possível carregar as categorias.')
    } finally {
      setCarregando(false)
    }
  }, [mesAtual])

  useEffect(() => {
    carregar()
    const id = setInterval(carregar, 60_000)
    return () => clearInterval(id)
  }, [carregar])

  const chartData = useMemo(() => {
    if (!dados?.categorias.length) return null
    const cats = dados.categorias
    const alpha = isDark ? 0.82 : 0.72

    return {
      labels: cats.map(c => c.label.length > 13 ? c.label.slice(0, 12) + '…' : c.label),
      datasets: [{
        label: 'Total',
        data: cats.map(c => c.valor),
        backgroundColor: cats.map((_, i) => rgba(PALETTE[i % PALETTE.length], alpha)),
        hoverBackgroundColor: cats.map((_, i) => rgba(PALETTE[i % PALETTE.length], 1)),
        borderRadius: 7,
        borderSkipped: 'bottom' as const,
        maxBarThickness: 56,
      }],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
    const tbg  = isDark ? 'rgba(15,23,42,0.97)' : 'rgba(15,23,42,0.93)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 420, easing: 'easeOutQuart' as const },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tbg,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          padding: { top: 10, right: 16, bottom: 10, left: 16 },
          cornerRadius: 12,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) =>
              dados?.categorias[items[0]?.dataIndex ?? 0]?.label ?? (items[0]?.label ?? ''),
            label: (ctx: TooltipItem<'bar'>) => {
              const cat = dados?.categorias[ctx.dataIndex]
              if (!cat) return ''
              return [
                `  Valor: ${formatBRL(cat.valor)}`,
                `  Participação: ${cat.pct.toFixed(1)}%`,
                `  Lançamentos: ${cat.contagem}`,
              ]
            },
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
          ticks: { font: { size: 10 }, color: txt, padding: 6, maxRotation: 35, minRotation: 0 },
          grid: { display: false },
          border: { display: false },
        },
      },
    }
  }, [isDark, dados])

  if (carregando && !dados) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
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

  if (!chartData || !dados?.categorias.length) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400">
        <BarChart3 className="w-8 h-8 opacity-30" />
        <span className="text-sm">Sem despesas registradas para este mês</span>
      </div>
    )
  }

  const minWidth = Math.max(dados.categorias.length * BAR_MIN_W, 320)

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div style={{ minWidth }} className="h-56 md:h-64 lg:h-72">
          <Bar data={chartData} options={options} />
        </div>
      </div>
    </div>
  )
}
