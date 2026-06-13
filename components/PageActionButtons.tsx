'use client'

import { Plus, Download } from 'lucide-react'

interface PageActionButtonsProps {
  onAdd: () => void
  onImport: () => void
  addDisabled?: boolean
  isImporting?: boolean
  addColorClass?: string
  importColorClass?: string
}

export default function PageActionButtons({
  onAdd,
  onImport,
  addDisabled = false,
  isImporting = false,
  addColorClass = 'bg-green-600 text-white hover:bg-green-700',
  importColorClass = 'bg-orange-500 text-white hover:bg-orange-600',
}: PageActionButtonsProps) {
  return (
    <div className="flex gap-2.5">
      <button
        onClick={onAdd}
        disabled={addDisabled}
        className={`flex-1 py-3 rounded-2xl font-semibold text-sm
                    flex items-center justify-center gap-2
                    transition-all duration-150 ease-spring
                    shadow-sm hover:shadow-card-md
                    active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-400
                    ${addColorClass}`}
      >
        <Plus className="w-4 h-4 shrink-0" />
        Adicionar
      </button>
      <button
        onClick={onImport}
        disabled={isImporting}
        className={`flex-1 py-3 rounded-2xl font-semibold text-sm
                    flex items-center justify-center gap-2
                    transition-all duration-150 ease-spring
                    shadow-sm hover:shadow-card-md
                    active:scale-[0.97] disabled:opacity-50
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-400
                    ${importColorClass}`}
      >
        <Download className={`w-4 h-4 shrink-0 ${isImporting ? 'animate-bounce' : ''}`} />
        {isImporting ? 'Importando…' : 'Mês anterior'}
      </button>
    </div>
  )
}
