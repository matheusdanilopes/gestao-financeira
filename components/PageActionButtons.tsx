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
    <div className="flex gap-2">
      <button
        onClick={onAdd}
        disabled={addDisabled}
        className={`flex-1 py-2.5 rounded-2xl font-semibold flex items-center justify-center gap-2 transition shadow-sm active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed ${addColorClass}`}
      >
        <Plus className="w-4 h-4" />
        Adicionar
      </button>
      <button
        onClick={onImport}
        disabled={isImporting}
        className={`flex-1 py-2.5 rounded-2xl font-semibold flex items-center justify-center gap-2 transition shadow-sm active:scale-[0.97] disabled:opacity-50 ${importColorClass}`}
      >
        <Download className="w-4 h-4" />
        {isImporting ? 'Importando…' : 'Mês anterior'}
      </button>
    </div>
  )
}
