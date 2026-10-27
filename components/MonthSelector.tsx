'use client'

import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { addMonths, subMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface MonthSelectorProps {
  value: Date
  onChange: (date: Date) => void
  onOpenSelector?: () => void
  className?: string
  /** 'inverse': pílula translúcida para fundo colorido (topo do Dashboard) */
  tone?: 'default' | 'inverse'
}

export default function MonthSelector({ value, onChange, onOpenSelector, className = '', tone = 'default' }: MonthSelectorProps) {
  const isMesAtual = format(value, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  if (tone === 'inverse') {
    return (
      <div className={`inline-flex items-center gap-0.5 bg-white/15 rounded-full p-1 text-white ${className}`}>
        <button
          onClick={(e) => { onChange(subMonths(value, 1)); e.currentTarget.blur() }}
          className="w-9 h-9 flex items-center justify-center rounded-full tap-scale hover:bg-white/15
                     transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 touch-manipulation"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={onOpenSelector}
          disabled={!onOpenSelector}
          className="inline-flex items-center gap-1 px-2 h-9 rounded-full font-semibold capitalize text-sm
                     hover:bg-white/15 tap-scale transition-colors focus:outline-none
                     focus-visible:ring-2 focus-visible:ring-white/60 touch-manipulation disabled:cursor-default"
          aria-label="Abrir seletor de período"
        >
          {format(value, 'MMMM yyyy', { locale: ptBR })}
          {onOpenSelector && <ChevronDown className="w-3.5 h-3.5 opacity-80 shrink-0" />}
        </button>
        <button
          onClick={(e) => { onChange(addMonths(value, 1)); e.currentTarget.blur() }}
          className="w-9 h-9 flex items-center justify-center rounded-full tap-scale hover:bg-white/15
                     transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 touch-manipulation"
          aria-label="Próximo mês"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        {!isMesAtual && (
          <button
            onClick={() => onChange(new Date())}
            className="ml-1 mr-1 px-2.5 h-7 rounded-full bg-white text-primary-700 text-[11px] font-semibold
                       tap-scale focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Hoje
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`flex items-center justify-between bg-white dark:bg-gray-900 rounded-2xl shadow-soft dark:border-gray-800 px-1 py-1 ${className}`}>
      <button
        onClick={(e) => { onChange(subMonths(value, 1)); e.currentTarget.blur() }}
        className="p-2.5 rounded-xl tap-scale hover:bg-gray-50 dark:hover:bg-gray-800
                   transition-colors focus:outline-none touch-manipulation"
        aria-label="Mês anterior"
      >
        <ChevronLeft className="w-5 h-5 text-gray-400 dark:text-gray-500" />
      </button>

      <div className="text-center flex-1 min-w-0 px-1">
        {onOpenSelector ? (
          <button
            onClick={onOpenSelector}
            className="inline-flex items-center gap-1.5 font-semibold capitalize
                       text-gray-800 dark:text-gray-100 text-sm leading-tight
                       rounded-xl px-2.5 py-1.5 -mx-2.5
                       hover:bg-gray-50 dark:hover:bg-gray-800
                       active:scale-[0.97] transition-all ease-spring duration-150
                       focus:outline-none touch-manipulation"
            aria-label="Abrir seletor de período"
          >
            {format(value, 'MMMM yyyy', { locale: ptBR })}
            <ChevronDown className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400 shrink-0 opacity-70" />
          </button>
        ) : (
          <p className="font-semibold capitalize text-gray-800 dark:text-gray-100 text-sm leading-tight">
            {format(value, 'MMMM yyyy', { locale: ptBR })}
          </p>
        )}
        {!isMesAtual && (
          <button
            onClick={() => onChange(new Date())}
            className="text-[11px] text-primary-600 dark:text-primary-400
                       hover:text-primary-700 dark:hover:text-primary-300
                       transition-colors duration-150 mt-0.5 block w-full
                       font-medium tracking-tight"
          >
            Ir para mês atual
          </button>
        )}
      </div>

      <button
        onClick={(e) => { onChange(addMonths(value, 1)); e.currentTarget.blur() }}
        className="p-2.5 rounded-xl tap-scale hover:bg-gray-50 dark:hover:bg-gray-800
                   transition-colors focus:outline-none touch-manipulation"
        aria-label="Próximo mês"
      >
        <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500" />
      </button>
    </div>
  )
}
