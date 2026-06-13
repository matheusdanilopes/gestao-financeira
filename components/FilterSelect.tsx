'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

/**
 * FilterSelect — dropdown de filtro em pílula (mesma aparência usada na Wishlist).
 *
 * Construído com <button> + painel custom (não usa <select> nativo), evitando
 * a regra global anti-zoom do iOS que força 16px em selects — assim mantém o
 * tamanho compacto (text-xs) e proporcional aos demais elementos do card.
 *
 * A primeira opção é tratada como "sem filtro": quando selecionada, a pílula
 * fica neutra (cinza); qualquer outra opção destaca a pílula em primary.
 */
export default function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isActive = value !== options[0]?.value
  const activeLabel = options.find(o => o.value === value)?.label ?? options[0]?.label

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                    transition-all duration-150 border
                    ${isActive
                      ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                      : 'bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
      >
        <span className="truncate">{activeLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 flex-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2.5}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-gray-900
                     rounded-xl shadow-lg border border-gray-100 dark:border-gray-700
                     z-50 overflow-hidden py-1"
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors
                          ${opt.value === value
                            ? 'text-primary-700 font-semibold bg-primary-50 dark:bg-primary-900/20 dark:text-primary-300'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            >
              <span className="w-3.5 h-3.5 flex-none flex items-center justify-center">
                {opt.value === value && (
                  <Check className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" strokeWidth={2.5} />
                )}
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
