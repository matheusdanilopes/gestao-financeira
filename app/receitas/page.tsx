'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MonthSelector from '@/components/MonthSelector'
import ReceitasMensal from '@/components/ReceitasMensal'
import { useMes } from '@/components/MesProvider'

function ReceitasContent() {
  const { mesAtual, setMesAtual } = useMes()
  const searchParams = useSearchParams()
  const autoOpen = searchParams.get('add') === 'true'

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3">Receitas</h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content">
        <ReceitasMensal mesSelecionado={mesAtual} autoOpen={autoOpen} />
      </div>
    </div>
  )
}

export default function ReceitasPage() {
  return (
    <Suspense>
      <ReceitasContent />
    </Suspense>
  )
}
