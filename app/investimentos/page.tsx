'use client'

import { Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import InvestimentosMensal from '@/components/InvestimentosMensal'
import MonthSelector from '@/components/MonthSelector'
import { useMes } from '@/components/MesProvider'
import { useDataSync } from '@/lib/useDataSync'
import { calcularSaldoInvestimentos, type SaldoData } from '@/lib/calcularSaldoInvestimentos'

function InvestimentosPageSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {/* Resumo skeleton */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-gray-100 rounded-lg shrink-0" />
          <div className="h-4 bg-gray-100 rounded-full w-48" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-3 bg-gray-100 rounded-full w-32" />
            <div className="h-3 bg-gray-100 rounded-full w-8" />
          </div>
          <div className="h-2 bg-gray-100 rounded-full" />
          <div className="flex justify-between mt-1">
            <div className="h-3 bg-gray-100 rounded-full w-24" />
            <div className="h-3 bg-gray-100 rounded-full w-36" />
          </div>
        </div>
      </div>
      {/* Lista skeleton */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-b-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-gray-100 rounded-full w-2/3" />
                <div className="h-3 bg-gray-100 rounded-full w-1/3" />
              </div>
              <div className="h-4 bg-gray-100 rounded-full w-20 shrink-0" />
            </div>
            <div className="pl-5">
              <div className="h-1.5 bg-gray-100 rounded-full w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InvestimentosContent() {
  const { mesAtual, setMesAtual } = useMes()
  const searchParams = useSearchParams()
  const autoOpen = searchParams.get('add') === 'true'
  const [saldo, setSaldo] = useState(0)
  const [saldoPrevisto, setSaldoPrevisto] = useState(0)

  const fetcher = useCallback(() => calcularSaldoInvestimentos(mesAtual), [mesAtual])

  const { status } = useDataSync({
    cacheKey: `investimentos-saldo:pagina:${format(mesAtual, 'yyyy-MM')}`,
    tables: ['transacoes_nubank', 'planejamento'],
    fetcher,
    onData: (data: unknown) => {
      const d = data as SaldoData
      setSaldo(d.saldo)
      setSaldoPrevisto(d.saldoPrevisto)
    },
  })

  const carregando = status === 'loading'

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3">Investimentos</h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content">
        {carregando ? (
          <InvestimentosPageSkeleton />
        ) : (
          <InvestimentosMensal mesSelecionado={mesAtual} saldo={saldo} saldoPrevisto={saldoPrevisto} autoOpen={autoOpen} />
        )}
      </div>
    </div>
  )
}

export default function InvestimentosPage() {
  return (
    <Suspense>
      <InvestimentosContent />
    </Suspense>
  )
}
