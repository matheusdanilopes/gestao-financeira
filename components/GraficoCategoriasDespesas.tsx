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
import { addMonths, format, startOfMonth } from 'date-fns'
import { AlertCircle, BarChart3 } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const NUBANK_ITEMS = new Set(['NuBank Matheus', 'NuBank Jeniffer', 'NuBank Jeniffer Conjunto'])
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
  contagem: number
  pctPago: number
  overBudget: boolean
  isCard: boolean
}

interface Props {
  mesAtual: Date
  cartao1Nome?: string
  cartao2Nome?: string
}

type CacheKey = string
type CacheEntry = { categorias: CategoryData[] }

export default function GraficoCategoriasDespesas({ mesAtual, cartao1Nome, cartao2Nome }: Props) {
  const [dados, setDados] = useState<CacheEntry | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()
  const cache = useRef(new Map<CacheKey, CacheEntry>())

  const carregar = useCallback(async () => {
    // Cache key includes card names so a change in label forces a refresh
    const mesKey = `${format(mesAtual, 'yyyy-MM')}|${cartao1Nome ?? ''}|${cartao2Nome ?? ''}`
    const cached = cache.current.get(mesKey)
    if (cached) {
      setDados(cached)
    } else {
      setCarregando(true)
    }
    setErro(null)

    try {
      const mesRefFatura = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')
      const mesRefAtual  = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

      // transacoes_nubank: fetch valor+cartao ONLY — no categoria.
      // We only need running totals per card, never individual purchase categories.
      const [{ data: transacoes }, { data: plan }] = await Promise.all([
        supabase
          .from('transacoes_nubank')
          .select('valor, cartao')
          .eq('projeto_fatura', mesRefFatura),
        supabase
          .from('planejamento')
          .select('item, valor_previsto, valor_real, pago, categoria')
          .eq('mes_referencia', mesRefAtual),
      ])

      // ── Consolidated totals from real transactions (no category split) ────
      const totalTransNubank = (transacoes ?? [])
        .filter(t => !t.cartao || t.cartao === 'nubank')
        .reduce((s, t) => s + Number(t.valor ?? 0), 0)

      const totalTransC1 = (transacoes ?? [])
        .filter(t => t.cartao === 'cartao1')
        .reduce((s, t) => s + Number(t.valor ?? 0), 0)

      const totalTransC2 = (transacoes ?? [])
        .filter(t => t.cartao === 'cartao2')
        .reduce((s, t) => s + Number(t.valor ?? 0), 0)

      // ── Card planned items from planejamento ──────────────────────────────
      const nubankPlanItems = (plan ?? []).filter(p => NUBANK_ITEMS.has(String(p.item ?? '')))
      const c1PlanItems     = (plan ?? []).filter(p => String(p.item ?? '').startsWith('[CARTAO1]'))
      const c2PlanItems     = (plan ?? []).filter(p => String(p.item ?? '').startsWith('[CARTAO2]'))

      // Previsto: sum of valor_previsto for each card
      const nubankPrevisto = nubankPlanItems.reduce((s, p) => s + Number(p.valor_previsto ?? 0), 0)
      const c1Previsto     = c1PlanItems.reduce((s, p) => s + Number(p.valor_previsto ?? 0), 0)
      const c2Previsto     = c2PlanItems.reduce((s, p) => s + Number(p.valor_previsto ?? 0), 0)

      // Pago (card priority): invoice confirmed payment > running transactions total
      function cardPago(
        planItems: typeof nubankPlanItems,
        transTotal: number,
      ): number {
        const paidItems = planItems.filter(p => p.pago)
        if (paidItems.length > 0)
          return paidItems.reduce((s, p) => s + Number(p.valor_real ?? p.valor_previsto ?? 0), 0)
        return transTotal
      }

      const nubankPago = cardPago(nubankPlanItems, totalTransNubank)
      const c1Pago     = cardPago(c1PlanItems, totalTransC1)
      const c2Pago     = cardPago(c2PlanItems, totalTransC2)

      // ── Build category maps ───────────────────────────────────────────────
      const prevMap = new Map<string, number>()
      const pagoMap = new Map<string, { valor: number; contagem: number; isCard: boolean }>()

      function addPrev(cat: string, v: number) {
        if (v > 0) prevMap.set(cat, (prevMap.get(cat) ?? 0) + v)
      }
      function addPago(cat: string, v: number, isCard = false) {
        if (v <= 0) return
        const e = pagoMap.get(cat) ?? { valor: 0, contagem: 0, isCard }
        e.valor += v
        if (!isCard) e.contagem++
        pagoMap.set(cat, e)
      }

      // Consolidated card entries (single label per card)
      const NUBANK_LABEL = 'NuBank'
      const C1_LABEL = cartao1Nome || 'Cartão 1'
      const C2_LABEL = cartao2Nome || 'Cartão 2'

      if (nubankPrevisto > 0) addPrev(NUBANK_LABEL, nubankPrevisto)
      if (nubankPago     > 0) addPago(NUBANK_LABEL, nubankPago, true)

      if (c1Previsto > 0) addPrev(C1_LABEL, c1Previsto)
      if (c1Pago     > 0) addPago(C1_LABEL, c1Pago, true)

      if (c2Previsto > 0) addPrev(C2_LABEL, c2Previsto)
      if (c2Pago     > 0) addPago(C2_LABEL, c2Pago, true)

      // Non-card planejamento items — use their categoria directly
      for (const p of (plan ?? [])) {
        const item = String(p.item ?? '')
        if (item === 'Receita Total' || item.startsWith('[RECEITA]')) continue
        if (NUBANK_ITEMS.has(item))         continue
        if (item.startsWith('[CARTAO1]'))   continue
        if (item.startsWith('[CARTAO2]'))   continue

        const pv = Number(p.valor_previsto ?? 0)
        const cat = p.categoria || 'Outros'
        if (pv > 0) addPrev(cat, pv)

        if (p.pago && p.valor_real != null) {
          const vr = Number(p.valor_real)
          if (vr > 0) addPago(cat, vr, false)
        }
      }

      // ── Merge, sort, slice ────────────────────────────────────────────────
      const allCats = new Set([...prevMap.keys(), ...pagoMap.keys()])
      const totalPago = [...pagoMap.values()].reduce((s, e) => s + e.valor, 0)

      const sorted = [...allCats]
        .map(cat => {
          const previsto = prevMap.get(cat) ?? 0
          const entry    = pagoMap.get(cat)
          const pago     = entry?.valor ?? 0
          return {
            label:    cat,
            previsto,
            pago,
            contagem: entry?.contagem ?? 0,
            isCard:   entry?.isCard ?? false,
          }
        })
        .sort((a, b) => Math.max(b.pago, b.previsto) - Math.max(a.pago, a.previsto))
        .slice(0, MAX_CATS)

      const categorias: CategoryData[] = sorted.map(({ label, previsto, pago, contagem, isCard }) => ({
        label,
        previsto,
        pago,
        contagem,
        pctPago:    totalPago > 0 ? (pago / totalPago) * 100 : 0,
        overBudget: pago > previsto && previsto > 0,
        isCard,
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
  }, [mesAtual, cartao1Nome, cartao2Nome])

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
              if (ctx.datasetIndex === 0) {
                return cat.previsto === 0 ? '  Previsto: —' : `  Previsto: ${formatBRL(cat.previsto)}`
              }
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
              // Only show lançamentos for non-card categories
              if (!cat.isCard && cat.contagem > 0)
                linhas.push(`  Lançamentos: ${cat.contagem}`)
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

  const minWidth = Math.max(dados.categorias.length * BAR_GROUP_MIN_W, 360)
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
            <span className="inline-block w-3 h-3 rounded-sm bg-indigo-500 opacity-80" />
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
