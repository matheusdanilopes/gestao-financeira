'use client'

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { formatBRL } from '@/lib/logger'
import { LayoutGrid, Hash, TrendingUp, X } from 'lucide-react'

interface Compra {
  hash_linha: string
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
  '#6366f1',
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

// Squarified treemap layout — minimizes worst aspect ratio per row
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
  compras: Compra[]
  loading?: boolean
}

export default function CategoryTreemap({ compras, loading }: Props) {
  const [mode, setMode] = useState<'value' | 'count'>('value')
  const [selected, setSelected] = useState<PlacedBlock | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [cW, setCW] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setCW(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset selection when data changes
  useEffect(() => { setSelected(null) }, [compras])

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
      <div className="bg-white rounded-3xl border border-gray-100 shadow-card mb-3">
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
    <div className="bg-white rounded-3xl border border-gray-100 shadow-card mb-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Categorias
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
        ref={ref}
        className="relative mx-3 mb-3 rounded-2xl overflow-hidden bg-gray-50"
        style={{ height: TREEMAP_H }}
      >
        {cW > 0 &&
          blocks.map(block => {
            const area = block.w * block.h
            const showName = area >= 2000
            const showValue = area >= 6000
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
                  transition: 'transform 150ms ease, filter 150ms ease',
                  filter: isSelected ? 'brightness(1.08)' : 'brightness(1)',
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
                        fontSize: area >= 9000 ? 13 : 10,
                        textShadow: '0 1px 3px rgba(0,0,0,0.28)',
                      }}
                    >
                      {block.label}
                    </p>
                  )}
                  {showValue && (
                    <p
                      className="text-[9px] font-semibold text-white/75 leading-tight truncate num mt-0.5"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.22)' }}
                    >
                      {formatBRL(block.valor)}
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
              <div className="grid grid-cols-4 gap-1.5">
                <div className="bg-white/60 rounded-xl p-1.5">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">Total</p>
                  <p className="text-[11px] font-bold text-gray-900 num mt-0.5 truncate">
                    {formatBRL(selected.valor)}
                  </p>
                </div>
                <div className="bg-white/60 rounded-xl p-1.5">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">Compras</p>
                  <p className="text-[11px] font-bold text-gray-900 mt-0.5">
                    {selected.contagem}×
                  </p>
                </div>
                <div className="bg-white/60 rounded-xl p-1.5">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">Médio</p>
                  <p className="text-[11px] font-bold text-gray-900 num mt-0.5 truncate">
                    {formatBRL(selected.valor / selected.contagem)}
                  </p>
                </div>
                <div className="bg-white/60 rounded-xl p-1.5">
                  <p className="text-[9px] text-gray-400 font-medium leading-tight">% fatura</p>
                  <p className="text-[11px] font-bold text-gray-900 mt-0.5">
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
