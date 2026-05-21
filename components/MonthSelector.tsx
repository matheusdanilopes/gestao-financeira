'use client'

import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { addMonths, subMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface MonthSelectorProps {
  value: Date
  onChange: (date: Date) => void
  onOpenSelector?: () => void
  className?: string
}

export default function MonthSelector({ value, onChange, onOpenSelector, className = '' }: MonthSelectorProps) {
  const isMesAtual = format(value, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  return (
    <div className={`flex items-center justify-between bg-white dark:bg-gray-900 rounded-2xl shadow-card border border-gray-100 dark:border-gray-800 px-1 py-1 ${className}`}>
      <button
        onClick={(e) => { onChange(subMonths(value, 1)); e.currentTarget.blur() }}
        className="p-2 rounded-xl transition-colors active:scale-95 focus:outline-none touch-manipulation"
        aria-label="Mês anterior"
      >
        <ChevronLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
      </button>

      <div className="text-center flex-1 min-w-[140px] px-2">
        {onOpenSelector ? (
          <button
            onClick={onOpenSelector}
            className="inline-flex items-center gap-1 font-semibold capitalize text-gray-800 dark:text-gray-100
                       text-sm leading-tight rounded-xl px-2 py-1 -mx-2
                       hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95
                       transition-all focus:outline-none touch-manipulation"
            aria-label="Abrir seletor de período"
          >
            {format(value, 'MMMM yyyy', { locale: ptBR })}
            <ChevronDown className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400 shrink-0" />
          </button>
        ) : (
          <p className="font-semibold capitalize text-gray-800 dark:text-gray-100 text-sm leading-tight">
            {format(value, 'MMMM yyyy', { locale: ptBR })}
          </p>
        )}
        {!isMesAtual && (
          <button
            onClick={() => onChange(new Date())}
            className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 transition-colors mt-0.5 block w-full"
          >
            Mês atual
          </button>
        )}
      </div>

      <button
        onClick={(e) => { onChange(addMonths(value, 1)); e.currentTarget.blur() }}
        className="p-2 rounded-xl transition-colors active:scale-95 focus:outline-none touch-manipulation"
        aria-label="Próximo mês"
      >
        <ChevronRight className="w-5 h-5 text-gray-500 dark:text-gray-400" />
      </button>
    </div>
  )
}
