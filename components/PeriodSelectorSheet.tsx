'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { startOfMonth } from 'date-fns'
import ModalPortal from '@/components/ModalPortal'

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril',
  'Maio', 'Junho', 'Julho', 'Agosto',
  'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const YEARS_BACK = 3
const YEARS_FORWARD = 2

function buildYears(): number[] {
  const current = new Date().getFullYear()
  return Array.from(
    { length: YEARS_BACK + YEARS_FORWARD + 1 },
    (_, i) => current - YEARS_BACK + i
  )
}

const ITEM_H = 44 // px — height of each picker item

interface ScrollPickerProps {
  items: string[]
  selectedIndex: number
  onSelect: (index: number) => void
  ariaLabel: string
}

function ScrollPicker({ items, selectedIndex, onSelect, ariaLabel }: ScrollPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const scrolling = useRef(false)
  const raf = useRef<number>(0)

  // Scroll to selected on mount and when selectedIndex changes externally
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: selectedIndex * ITEM_H, behavior: 'smooth' })
  }, [selectedIndex])

  const handleScroll = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = listRef.current
      if (!el) return
      const idx = Math.round(el.scrollTop / ITEM_H)
      const clamped = Math.max(0, Math.min(items.length - 1, idx))
      if (!scrolling.current) {
        onSelect(clamped)
      }
    })
  }, [items.length, onSelect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(selectedIndex + 1, items.length - 1)
      onSelect(next)
      listRef.current?.scrollTo({ top: next * ITEM_H, behavior: 'smooth' })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = Math.max(selectedIndex - 1, 0)
      onSelect(prev)
      listRef.current?.scrollTo({ top: prev * ITEM_H, behavior: 'smooth' })
    }
  }, [selectedIndex, items.length, onSelect])

  return (
    <div className="relative flex-1" role="group" aria-label={ariaLabel}>
      {/* fade top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 z-10
                      bg-gradient-to-b from-white dark:from-gray-900 to-transparent" />
      {/* highlight band */}
      <div className="pointer-events-none absolute inset-x-2 z-10 rounded-xl
                      border border-primary-200 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/30"
           style={{ top: `calc(50% - ${ITEM_H / 2}px)`, height: ITEM_H }} />
      {/* fade bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 z-10
                      bg-gradient-to-t from-white dark:from-gray-900 to-transparent" />

      <ul
        ref={listRef}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className="overflow-y-scroll overscroll-contain outline-none"
        style={{
          height: ITEM_H * 5,
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch' as never,
          scrollbarWidth: 'none',
        }}
      >
        {/* padding items so first/last can center */}
        <li aria-hidden style={{ height: ITEM_H * 2, flexShrink: 0 }} />
        {items.map((label, i) => (
          <li
            key={label}
            role="option"
            aria-selected={i === selectedIndex}
            onClick={() => {
              onSelect(i)
              listRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
            }}
            className="flex items-center justify-center cursor-pointer select-none transition-all"
            style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
          >
            <span className={`text-sm font-medium transition-all duration-150 ${
              i === selectedIndex
                ? 'text-primary-600 dark:text-primary-400 text-base font-semibold scale-105'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {label}
            </span>
          </li>
        ))}
        <li aria-hidden style={{ height: ITEM_H * 2, flexShrink: 0 }} />
      </ul>
    </div>
  )
}

interface PeriodSelectorSheetProps {
  isOpen: boolean
  currentPeriod: Date
  onConfirm: (period: Date) => void
  onClose: () => void
}

export default function PeriodSelectorSheet({
  isOpen,
  currentPeriod,
  onConfirm,
  onClose,
}: PeriodSelectorSheetProps) {
  const years = buildYears()
  const [selectedMonth, setSelectedMonth] = useState(currentPeriod.getMonth())
  const [selectedYear, setSelectedYear] = useState(currentPeriod.getFullYear())
  const [isDesktop, setIsDesktop] = useState(false)
  const [visible, setVisible] = useState(false)

  // Sync with external period when sheet opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMonth(currentPeriod.getMonth())
      setSelectedYear(currentPeriod.getFullYear())
    }
  }, [isOpen, currentPeriod])

  // Detect desktop breakpoint (after mount to avoid SSR mismatch)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Animate in/out
  useEffect(() => {
    if (isOpen) {
      // Tiny delay lets the DOM render before animating
      const t = setTimeout(() => setVisible(true), 10)
      return () => clearTimeout(t)
    } else {
      setVisible(false)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Prevent body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  function handleConfirm() {
    const yearIdx = years.indexOf(selectedYear)
    const year = years[yearIdx] ?? years[YEARS_BACK]
    onConfirm(startOfMonth(new Date(year, selectedMonth, 1)))
    onClose()
  }

  const monthIdx = selectedMonth
  const yearIdx = years.indexOf(selectedYear) === -1
    ? YEARS_BACK
    : years.indexOf(selectedYear)

  if (!isOpen && !visible) return null

  const pickerContent = (
    <div className="flex gap-1 px-4" style={{ height: ITEM_H * 5 }}>
      <ScrollPicker
        items={MESES}
        selectedIndex={monthIdx}
        onSelect={setSelectedMonth}
        ariaLabel="Selecionar mês"
      />
      <div className="w-px bg-gray-100 dark:bg-gray-800 self-stretch my-3" />
      <ScrollPicker
        items={years.map(String)}
        selectedIndex={yearIdx}
        onSelect={(i) => setSelectedYear(years[i])}
        ariaLabel="Selecionar ano"
      />
    </div>
  )

  const actions = (
    <div className="flex gap-3 px-4 pb-4 pt-2">
      <button
        onClick={onClose}
        className="flex-1 py-3 rounded-2xl border border-gray-200 dark:border-gray-700
                   text-gray-600 dark:text-gray-300 font-medium text-sm
                   active:scale-95 transition-all hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Cancelar
      </button>
      <button
        onClick={handleConfirm}
        className="flex-1 py-3 rounded-2xl bg-primary-600 hover:bg-primary-700
                   text-white font-semibold text-sm
                   active:scale-95 transition-all shadow-sm"
      >
        Confirmar
      </button>
    </div>
  )

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Selecionar período"
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          className="absolute inset-0 bg-black/60"
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={onClose}
          aria-hidden="true"
        />

        {isDesktop ? (
          /* ── Desktop: centered popover ── */
          <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                           w-80 bg-white dark:bg-gray-900 rounded-3xl shadow-float
                           border border-gray-100 dark:border-gray-800
                           transition-all duration-300 ${
            visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 text-center">
                Selecionar período
              </h2>
            </div>
            {pickerContent}
            {actions}
          </div>
        ) : (
          /* ── Mobile: bottom sheet ── */
          <div className={`absolute bottom-0 left-0 right-0
                           bg-white dark:bg-gray-900 rounded-t-[28px] shadow-2xl
                           transition-transform duration-300 ease-out ${
            visible ? 'translate-y-0' : 'translate-y-full'
          }`}
               style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="px-4 pt-1 pb-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 text-center">
                Selecionar período
              </h2>
            </div>
            {pickerContent}
            {actions}
          </div>
        )}
      </div>
    </ModalPortal>
  )
}
