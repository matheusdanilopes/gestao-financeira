'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, subMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface MonthSelectorProps {
  value: Date
  onChange: (date: Date) => void
  className?: string
}

export default function MonthSelector({ value, onChange, className = '' }: MonthSelectorProps) {
  const isMesAtual = format(value, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  return (
    <div className={`flex items-center justify-between bg-white rounded-2xl shadow-card border border-gray-100 px-1 py-1 ${className}`}>
      <button
        onClick={(e) => { onChange(subMonths(value, 1)); e.currentTarget.blur() }}
        className="p-2 hover:bg-gray-100 rounded-xl transition-colors active:scale-95 focus:outline-none"
        aria-label="Mês anterior"
      >
        <ChevronLeft className="w-5 h-5 text-gray-500" />
      </button>

      <div className="text-center flex-1 min-w-0 px-2">
        <p className="font-semibold capitalize text-gray-800 text-sm leading-tight">
          {format(value, 'MMMM yyyy', { locale: ptBR })}
        </p>
        {!isMesAtual && (
          <button
            onClick={() => onChange(new Date())}
            className="text-xs text-primary-600 hover:text-primary-700 transition-colors mt-0.5"
          >
            Mês atual
          </button>
        )}
      </div>

      <button
        onClick={(e) => { onChange(addMonths(value, 1)); e.currentTarget.blur() }}
        className="p-2 hover:bg-gray-100 rounded-xl transition-colors active:scale-95 focus:outline-none"
        aria-label="Próximo mês"
      >
        <ChevronRight className="w-5 h-5 text-gray-500" />
      </button>
    </div>
  )
}
