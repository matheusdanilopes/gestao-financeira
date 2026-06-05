'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { formatBRL } from '@/lib/logger'
import { LayoutGrid, Hash, TrendingUp, X } from 'lucide-react'
import { addMonths, format, startOfMonth } from 'date-fns'
import { supabase } from '@/lib/supabaseClient'

interface CompraItem {
  valor: number
  categoria: string | null
}

interface CategoryItem {
  label: string
  valor: number
  contagem: number
  pct: number
  color: string
}

interface PlacedBlock extends CategoryItem {
  x: number
  y: number
  w: number
  h: number
}

const COLORS = [
  '#059669',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#10b981',
  '#f59e0b',
  '#06b6d4',
  '#f97316',
]

const TREEMAP_H = 220
const GAP = 3
const MAX_CATS = 8
const MIN_PCT = 2

// Squarified treemap — minimises worst aspect ratio per strip
function squarifyLayout(
  items: CategoryItem[],
  W: number,
  H: number,
  getSize: (item: CategoryItem) => number,
): PlacedBlock[] {
  if (!items.length || W <= 0 || H <= 0) return []
  const totalSize = items.reduce((s, i) => s + getSize(i), 0)
  if (!totalSize) return []

  const containerArea = W * H
  const nodes = items.map(item => ({ item, area: (getSize(item) / totalSize) * containerArea }))

  const result: PlacedBlock[] = []
  const g = GAP / 2

  function worstAspect(areas: number[], S: number): number {
    if (!areas.length || S <= 0) return Infinity
    const sum = areas.reduce((a, b) => a + b, 0)
    const l = sum / S
    if (l <= 0) return Infinity
    let worst = 0
    for (const a of areas) {
      const c = a / l
      const r = l > c ? l / c : c / l
      if (r > worst) worst = r
    }
    return worst
  }

  function placeRow(
    row: Array<{ item: CategoryItem; area: number }>,
    x: number, y: number, w: number, h: number,
  ) {
    const isH = w >= h
    const S = isH ? h : w
    if (S <= 0) return
    const rowSum = row.reduce((s, n) => s + n.area, 0)
    const l = rowSum / S
    if (l <= 0) return
    let offset = 0
    for (const { item, area } of row) {
      const c = area / l
      result.push({
        ...item,
        x: isH ? x + g : x + offset + g,
        y: isH ? y + offset + g : y + g,
        w: Math.max(isH ? l - GAP : c - GAP, 2),
        h: Math.max(isH ? c - GAP : l - GAP, 2),
      })
      offset += c
    }
  }

  let fx = 0, fy = 0, fw = W, fh = H
  let row: Array<{ item: CategoryItem; area: number }> = []
  let rowAreas: number[] = []
  let i = 0

  while (i < nodes.length) {
    if (fw < 1 || fh < 1) break
    const S = Math.min(fw, fh)
    const next = nodes[i]
    const newAreas = [...rowAreas, next.area]
    const wWith = worstAspect(newAreas, S)
    const wWithout = rowAreas.length ? worstAspect(rowAreas, S) : Infinity

    if (!row.length || wWith <= wWithout) {
      row.push(next)
      rowAreas.push(next.area)
      i++
    } else {
      placeRow(row, fx, fy, fw, fh)
      const rowSum = rowAreas.reduce((a, b) => a + b, 0)
      const l = rowSum / S
      if (fw >= fh) { fx += l; fw = Math.max(fw - l, 0) }
      else { fy += l; fh = Math.max(fh - l, 0) }
      row = []
      rowAreas = []
    }
  }
  if (row.length) placeRow(row, fx, fy, fw, fh)

  return result
}

interface Props {
  /** Provide purchases directly (e.g. from filtered list). */
  compras?: CompraItem[]
  /**
   * When provided, the component fetches its own data for the invoice of
   * addMonths(mesAtual, 1) — use this from the dashboard.
   */
  mesAtual?: Date
  loading?: boolean
}

export default function CategoryTreemap({ compras: comprasProp, mesAtual, loading: loadingProp }: Props) {
  const [mode, setMode] = useState<'value' | 'count'>('value')
  const [selected, setSelected] = useState<PlacedBlock | null>(null)
  const [cW, setCW] = useState(0)

  // Self-fetching mode (used by dashboard)
  const [fetchedCompras, setFetchedCompras] = useState<CompraItem[]>([])
  const [fetchLoading, setFetchLoading] = useState(false)

  const mesRefFatura = useMemo(
    () => mesAtual ? format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd') : null,
    [mesAtual],
  )

  useEffect(() => {
    if (!mesRefFatura) return
    let cancelled = false
    setFetchLoading(true)
    supabase
      .from('transacoes_nubank')
      .select('valor, categoria')
      .eq('projeto_fatura', mesRefFatura)
      .then(({ data }) => {
        if (!cancelled) {
          setFetchedCompras((data ?? []) as CompraItem[])
          setFetchLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [mesRefFatura])

  // Reset selection when data source changes
  useEffect(() => { setSelected(null) }, [comprasProp, mesRefFatura])

  const compras = comprasProp ?? fetchedCompras
  const loading = loadingProp ?? fetchLoading

  // Callback ref — correctly sets up ResizeObserver whenever the div mounts
  // (fixes the case where loading=true delays the div mount past the initial useEffect)
  const observerRef = useRef<ResizeObserver | null>(null)
  const containerCb = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setCW(entries[0].contentRect.width)
    })
    ro.observe(el)
    observerRef.current = ro
  }, [])

  const categories = useMemo<CategoryItem[]>(() => {
    if (!compras.length) return []

    const map = new Map<string, { valor: number; contagem: number }>()
    for (const c of compras) {
      const key = c.categoria || 'Sem categoria'
      const e = map.get(key) ?? { valor: 0, contagem: 0 }
      e.valor += c.valor
      e.contagem++
      map.set(key, e)
    }

    const totalVal = compras.reduce((s, c) => s + c.valor, 0)
    const sorted = [...map.entries()].sort(([, a], [, b]) => b.valor - a.valor)

    const main: CategoryItem[] = sorted
      .filter((_, idx) => idx < MAX_CATS && (sorted[idx][1].valor / totalVal) * 100 >= MIN_PCT)
      .map(([label, d], i) => ({
        label,
        valor: d.valor,
        contagem: d.contagem,
        pct: totalVal > 0 ? (d.valor / totalVal) * 100 : 0,
        color: COLORS[i % COLORS.length],
      }))

    const mainLabels = new Set(main.map(m => m.label))
    const others = sorted.filter(([label]) => !mainLabels.has(label))

    if (others.length > 0) {
      const outrosValor = others.reduce((s, [, d]) => s + d.valor, 0)
      main.push({
        label: 'Outros',
        valor: outrosValor,
        contagem: others.reduce((s, [, d]) => s + d.contagem, 0),
        pct: totalVal > 0 ? (outrosValor / totalVal) * 100 : 0,
        color: '#94a3b8',
      })
    }

    return main
  }, [compras])

  const getSize = useCallback(
    (item: CategoryItem) => (mode === 'value' ? item.valor : item.contagem),
    [mode],
  )

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => getSize(b) - getSize(a)),
    [categories, getSize],
  )

  const blocks = useMemo(
    () => squarifyLayout(sortedCategories, cW, TREEMAP_H, getSize),
    [sortedCategories, cW, getSize],
  )

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 shadow-card mb-4">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="h-3.5 w-20 bg-gray-200 rounded-xl animate-pulse" />
          <div className="h-6 w-28 bg-gray-100 rounded-xl animate-pulse" />
        </div>
        <div className="h-[220px] mx-3 mb-3 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!compras.length) return null

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-card mb-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Categorias da Fatura
          </span>
        </div>
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          <button
            onClick={() => setMode('value')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              mode === 'value'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-400 hover:text-gray-600'
            }`}
          >
            <TrendingUp className="w-3 h-3" />
            Valor
          </button>
          <button
            onClick={() => setMode('count')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              mode === 'count'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-400 hover:text-gray-600'
            }`}
          >
            <Hash className="w-3 h-3" />
            Qtd
          </button>
        </div>
      </div>

      {/* Treemap canvas */}
      <div
        ref={containerCb}
        className="relative mx-3 mb-3 rounded-2xl overflow-hidden bg-gray-50"
        style={{ height: TREEMAP_H }}
      >
        {cW > 0 &&
          blocks.map(block => {
            // Dimension-based thresholds — more reliable than area alone
            const showName = block.w >= 36 && block.h >= 26
            const showValue = block.w >= 52 && block.h >= 40
            const isSelected = selected?.label === block.label

            return (
              <button
                key={block.label}
                onClick={() => setSelected(isSelected ? null : block)}
                className="absolute overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{
                  left: block.x,
                  top: block.y,
                  width: block.w,
                  height: block.h,
                  borderRadius: 10,
                  backgroundColor: block.color,
                  transform: isSelected ? 'scale(0.97)' : 'scale(1)',
                  transition: 'transform 120ms ease',
                  willChange: 'transform',
                }}
                aria-label={`${block.label}: ${formatBRL(block.valor)}`}
              >
                {/* Depth gradient */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.06) 100%)',
                  }}
                />
                {/* Text */}
                <div className="relative w-full h-full flex flex-col justify-end p-2">
                  {showName && (
                    <p
                      className="font-bold leading-tight text-white truncate"
                      style={{
                        fontSize: block.w >= 90 && block.h >= 60 ? 13 : 10,
                        textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }}
                    >
                      {block.label}
                    </p>
                  )}
                  {showValue && (
                    <p
                      className="text-[9px] font-semibold text-white/80 leading-tight truncate num mt-0.5"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
                    >
                      {mode === 'value' ? formatBRL(block.valor) : `${block.contagem}×`}
                    </p>
                  )}
                </div>
                {/* Selected ring */}
                {isSelected && (
                  <div className="absolute inset-0 pointer-events-none rounded-[10px] ring-2 ring-white" />
                )}
              </button>
            )
          })}
      </div>

      {/* Detail card */}
      {selected && (
        <div
          className="mx-3 mb-3 rounded-2xl p-3"
          style={{ backgroundColor: selected.color + '1c' }}
        >
          <div className="flex items-start gap-2.5">
            <div
              className="w-8 h-8 rounded-xl shrink-0 mt-0.5"
              style={{ backgroundColor: selected.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-900 truncate pr-1">{selected.label}</p>
                <button
                  onClick={() => setSelected(null)}
                  className="p-0.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-black/5 transition-colors shrink-0"
                  aria-label="Fechar detalhe"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-white/60 rounded-xl p-2">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">Total</p>
                  <p className="text-xs font-bold text-gray-900 num mt-0.5 whitespace-nowrap">
                    {formatBRL(selected.valor)}
                  </p>
                </div>
                <div className="bg-white/60 rounded-xl p-2">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">Compras</p>
                  <p className="text-xs font-bold text-gray-900 mt-0.5">{selected.contagem}×</p>
                </div>
                <div className="bg-white/60 rounded-xl p-2">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">Ticket médio</p>
                  <p className="text-xs font-bold text-gray-900 num mt-0.5 whitespace-nowrap">
                    {formatBRL(selected.valor / selected.contagem)}
                  </p>
                </div>
                <div className="bg-white/60 rounded-xl p-2">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">% fatura</p>
                  <p className="text-xs font-bold text-gray-900 mt-0.5">
                    {selected.pct.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
