'use client'

import MonthSelector from '@/components/MonthSelector'
import ParcelamentosMensal from '@/components/ParcelamentosMensal'
import { useMes } from '@/components/MesProvider'
import { InfoPopover } from '@/components/InfoPopover'

export default function ParcelamentosPage() {
  const { mesAtual, setMesAtual } = useMes()

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-1.5">
          Parcelamentos
          <InfoPopover texto="Reúne compras parceladas do cartão e itens parcelados do planejamento manual. Defina um limite mensal por pessoa para saber se ainda cabe mais uma parcela — se um mês não tiver limite próprio, ele herda o valor do mês anterior configurado, e você pode alterá-lo livremente sem afetar o histórico." />
        </h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content">
        <ParcelamentosMensal mesAtual={mesAtual} />
      </div>
    </div>
  )
}
