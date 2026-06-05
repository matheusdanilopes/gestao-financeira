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
import { format, startOfMonth } from 'date-fns'
import { AlertCircle, BarChart3 } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MAX_CATS = 12
const BAR_GROUP_MIN_W = 88

const PALETTE = [
  [99,  102, 241] as const,
  [139, 92,  246] as const,
  [59,  130, 246] as const,
  [236, 72,  153] as const,
  [16,  185, 129] as const,
  [245, 158, 11 ] as const,
  [6,   182, 212] as const,
  [249, 115, 22 ] as const,
  [239, 68,  68 ] as const,
  [20,  184, 166] as const,
  [168, 85,  247] as const,
  [34,  197, 94 ] as const,
]

const OVER_BUDGET_COLOR = [239, 68, 68] as const

function rgba(c: readonly [number, number, number], a = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

interface CategoryData {
  label: string
  previsto: number
  pago: number
  contagem: number   // paid items count
  pctPago: number
  overBudget: boolean
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
      const mesRefAtual = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

      // Source of truth: planejamento only.
      // Categories are assigned by the user in the despesas screen — no
      // individual card transaction breakdown needed or wanted here.
      const { data: plan } = await supabase
        .from('planejamento')
        .select('item, valor_previsto, valor_real, pago, categoria')
        .eq('mes_referencia', mesRefAtual)

      const prevMap = new Map<string, number>()
      const pagoMap = new Map<string, { valor: number; contagem: number }>()

      for (const p of (plan ?? [])) {
        const item = String(p.item ?? '')
        if (item === 'Receita Total' || item.startsWith('[RECEITA]')) continue

        const cat = p.categoria || 'Outros'
        const pv  = Number(p.valor_previsto ?? 0)

        if (pv > 0)
          prevMap.set(cat, (prevMap.get(cat) ?? 0) + pv)

        if (p.pago && p.valor_real != null) {
          const vr = Number(p.valor_real)
          if (vr > 0) {
            const e = pagoMap.get(cat) ?? { valor: 0, contagem: 0 }
            e.valor += vr
            e.contagem++
            pagoMap.set(cat, e)
          }
        }
      }

      const allCats  = new Set([...prevMap.keys(), ...pagoMap.keys()])
      const totalPago = [...pagoMap.values()].reduce((s, e) => s + e.valor, 0)

      const sorted = [...allCats]
        .map(cat => ({
          label:    cat,
          previsto: prevMap.get(cat) ?? 0,
          pago:     pagoMap.get(cat)?.valor ?? 0,
          contagem: pagoMap.get(cat)?.contagem ?? 0,
        }))
        .sort((a, b) => Math.max(b.pago, b.previsto) - Math.max(a.pago, a.previsto))
        .slice(0, MAX_CATS)

      const categorias: CategoryData[] = sorted.map(({ label, previsto, pago, contagem }) => ({
        label,
        previsto,
        pago,
        contagem,
        pctPago:    totalPago > 0 ? (pago / totalPago) * 100 : 0,
        overBudget: pago > previsto && previsto > 0,
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
    const pagoAlpha = isDark ? 0.82 : 0.78

    return {
      labels: cats.map(c => c.label.length > 11 ? c.label.slice(0, 10) + '…' : c.label),
      datasets: [
        {
          label: 'Previsto',
          data: cats.map(c => c.previsto),
          backgroundColor: rgba([148, 163, 184], isDark ? 0.28 : 0.30),
          hoverBackgroundColor: rgba([148, 163, 184], isDark ? 0.45 : 0.45),
          borderColor: rgba([148, 163, 184], isDark ? 0.55 : 0.50),
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: 'bottom' as const,
          maxBarThickness: 32,
        },
        {
          label: 'Pago',
          data: cats.map(c => c.pago),
          backgroundColor: cats.map((c, i) =>
            c.overBudget
              ? rgba(OVER_BUDGET_COLOR, pagoAlpha)
              : rgba(PALETTE[i % PALETTE.length], pagoAlpha)
          ),
          hoverBackgroundColor: cats.map((c, i) =>
            c.overBudget
              ? rgba(OVER_BUDGET_COLOR, 1)
              : rgba(PALETTE[i % PALETTE.length], 1)
          ),
          borderRadius: 6,
          borderSkipped: 'bottom' as const,
          maxBarThickness: 32,
        },
      ],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    const txt  = isDark ? '#9ca3af' : '#6b7280'
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
    const tbg  = isDark ? 'rgba(15,23,42,0.97)' : 'rgba(15,23,42,0.93)'

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 430, easing: 'easeOutQuart' as const },
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tbg,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          padding: { top: 10, right: 16, bottom: 12, left: 16 },
          cornerRadius: 12,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) =>
              dados?.categorias[items[0]?.dataIndex ?? 0]?.label ?? (items[0]?.label ?? ''),
            label: (ctx: TooltipItem<'bar'>) => {
              const cat = dados?.categorias[ctx.dataIndex]
              if (!cat) return ''
              if (ctx.datasetIndex === 0)
                return cat.previsto === 0 ? '  Previsto: —' : `  Previsto: ${formatBRL(cat.previsto)}`

              const linhas: string[] = [
                `  Pago: ${cat.pago > 0 ? formatBRL(cat.pago) : '—'}`,
              ]
              if (cat.previsto > 0 && cat.pago > 0) {
                const diff  = cat.pago - cat.previsto
                const pct   = (diff / cat.previsto) * 100
                const sinal = diff >= 0 ? '+' : ''
                linhas.push(`  Diferença: ${sinal}${formatBRL(diff)}`)
                linhas.push(`  Variação: ${sinal}${pct.toFixed(1)}%`)
              }
              if (cat.contagem > 0)
                linhas.push(`  Itens pagos: ${cat.contagem}`)
              return linhas
            },
            afterBody: (items: TooltipItem<'bar'>[]) => {
              const cat = dados?.categorias[items[0]?.dataIndex ?? 0]
              if (cat?.overBudget) return ['', '  ⚠ Acima do previsto']
              return []
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
          ticks: { font: { size: 10 }, color: txt, padding: 5, maxRotation: 35, minRotation: 0 },
          grid: { display: false },
          border: { display: false },
        },
      },
    }
  }, [isDark, dados])

  if (carregando && !dados) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
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

  const minWidth  = Math.max(dados.categorias.length * BAR_GROUP_MIN_W, 360)
  const overCount = dados.categorias.filter(c => c.overBudget).length

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div style={{ minWidth }} className="h-56 md:h-64 lg:h-72">
          <Bar data={chartData} options={options} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
        <p className="flex items-center gap-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-slate-300 dark:bg-slate-500 opacity-70" />
            Previsto
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-primary-500 opacity-80" />
            Pago
          </span>
          {overCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-red-500 opacity-80" />
              Acima do previsto
            </span>
          )}
        </p>
        {overCount > 0 && (
          <span className="text-[11px] font-medium text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">
            ⚠ {overCount} {overCount === 1 ? 'categoria acima' : 'categorias acima'} do previsto
          </span>
        )}
      </div>
    </div>
  )
}
