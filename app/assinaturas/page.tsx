'use client'

import MonthSelector from '@/components/MonthSelector'
import AssinaturasMensal from '@/components/AssinaturasMensal'
import SugestoesAssinaturas from '@/components/SugestoesAssinaturas'
import { useMes } from '@/components/MesProvider'

export default function AssinaturasPage() {
  const { mesAtual, setMesAtual } = useMes()

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-[10]">
        <h1 className="font-display italic text-xl font-semibold text-gray-900 mb-3">Assinaturas</h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content">
        <SugestoesAssinaturas />
        <AssinaturasMensal mesSelecionado={mesAtual} />
      </div>
    </div>
  )
}
