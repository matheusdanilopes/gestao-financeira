'use client'

import MonthSelector from '@/components/MonthSelector'
import ChecklistMensal from '@/components/ChecklistMensal'
import { addMonths, subMonths, format } from 'date-fns'
import { useMes } from '@/components/MesProvider'

export default function ContasPage() {
  const { mesAtual, setMesAtual } = useMes()

  return (
    <div className="min-h-screen bg-gray-50 pb-28 page-enter">
      <div className="sticky top-0 sticky-header pt-3 pb-3 px-4 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3">Despesas</h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="px-4">
        <ChecklistMensal mesSelecionado={mesAtual} />
      </div>
    </div>
  )
}
