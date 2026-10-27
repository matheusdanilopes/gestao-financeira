'use client'

import { Plus, Download } from 'lucide-react'

interface PageActionButtonsProps {
  onAdd: () => void
  onImport: () => void
  addDisabled?: boolean
  isImporting?: boolean
}

export default function PageActionButtons({
  onAdd,
  onImport,
  addDisabled = false,
  isImporting = false,
}: PageActionButtonsProps) {
  return (
    <div className="flex gap-2.5">
      <button
        onClick={onAdd}
        disabled={addDisabled}
        className="flex-1 py-3 rounded-full font-semibold text-sm
                   flex items-center justify-center gap-2
                   bg-primary-600 text-white hover:bg-primary-700
                   transition-all duration-150 ease-smooth
                   active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400"
      >
        <Plus className="w-4 h-4 shrink-0" />
        Adicionar
      </button>
      <button
        onClick={onImport}
        disabled={isImporting}
        className="flex-1 py-3 rounded-full font-semibold text-sm
                   flex items-center justify-center gap-2
                   bg-primary-50 text-primary-700 hover:bg-primary-100
                   transition-all duration-150 ease-smooth
                   active:scale-[0.97] disabled:opacity-50
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400"
      >
        <Download className={`w-4 h-4 shrink-0 ${isImporting ? 'animate-bounce' : ''}`} />
        {isImporting ? 'Importando…' : 'Mês anterior'}
      </button>
    </div>
  )
}
