'use client'

import { useState } from 'react'

const PATH_PLUS  = "M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11H7v2h4v4h2v-4h4v-2h-4V7h-2v4z"
const PATH_CHECK = "M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-.997-6l-3.536-3.536 1.414-1.414 2.122 2.122 4.243-4.243 1.414 1.414L11.003 16z"

type Props = {
  onRealizar: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
}

export function RealizarButton({ onRealizar, disabled = false }: Props) {
  const [morphed, setMorphed] = useState(false)
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) return

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(80)
    }

    if (!prefersReduced) {
      setTimeout(() => setMorphed(true), 80)
    } else {
      setMorphed(true)
    }

    onRealizar(e)
  }

  const dur = prefersReduced ? '0ms' : '200ms'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-600
                 text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors active:scale-95
                 disabled:opacity-50 disabled:pointer-events-none"
      aria-label="Marcar como realizado"
    >
      <svg
        width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth={2.5}
        strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={PATH_PLUS}  style={{ opacity: morphed ? 0 : 1, transition: `opacity ${dur} ease` }} />
        <path d={PATH_CHECK} style={{ opacity: morphed ? 1 : 0, transition: `opacity ${dur} ease ${morphed ? '0ms' : '80ms'}` }} />
      </svg>
      Realizar
    </button>
  )
}
