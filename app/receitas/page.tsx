'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MonthSelector from '@/components/MonthSelector'
import ReceitasMensal from '@/components/ReceitasMensal'
import { useMes } from '@/components/MesProvider'

function ReceitasPageSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {/* Resumo skeleton */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-gray-100 rounded-lg shrink-0" />
          <div className="h-4 bg-gray-100 rounded-full w-40" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-3 bg-gray-100 rounded-full w-28" />
            <div className="h-3 bg-gray-100 rounded-full w-8" />
          </div>
          <div className="h-2 bg-gray-100 rounded-full" />
        </div>
      </div>
      {/* Lista skeleton */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3 border-b border-gray-100 last:border-b-0">
            <div className="w-2 h-2 rounded-full bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-gray-100 rounded-full w-2/3" />
              <div className="h-2 bg-gray-100 rounded-full w-full" />
            </div>
            <div className="h-4 bg-gray-100 rounded-full w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

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
        <Suspense fallback={<ReceitasPageSkeleton />}>
          <ReceitasMensal mesSelecionado={mesAtual} autoOpen={autoOpen} />
        </Suspense>
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
