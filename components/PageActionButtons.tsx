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
  // Ação primária (criar) em teal — a cor de marca do app — e a secundária
  // (trazer do mês anterior) em tom tonal sobre ela, para não competir por atenção
  // com dois blocos sólidos saturados lado a lado.
  addColorClass = 'bg-primary-600 text-white hover:bg-primary-700',
  importColorClass = 'bg-primary-50 text-primary-700 border border-primary-100 hover:bg-primary-100',
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
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400
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
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400
                    ${importColorClass}`}
      >
        <Download className={`w-4 h-4 shrink-0 ${isImporting ? 'animate-bounce' : ''}`} />
        {isImporting ? 'Importando…' : 'Mês anterior'}
      </button>
    </div>
  )
}
