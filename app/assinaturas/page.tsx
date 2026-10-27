'use client'

import MonthSelector from '@/components/MonthSelector'
import AssinaturasMensal from '@/components/AssinaturasMensal'
import SugestoesAssinaturas from '@/components/SugestoesAssinaturas'
import { useMes } from '@/components/MesProvider'
import PageHeader from '@/components/PageHeader'

export default function AssinaturasPage() {
  const { mesAtual, setMesAtual } = useMes()

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <PageHeader title="Assinaturas">
        <MonthSelector tone="inverse" value={mesAtual} onChange={setMesAtual} />
      </PageHeader>

      <div className="page-content">
        <SugestoesAssinaturas />
        <AssinaturasMensal mesSelecionado={mesAtual} />
      </div>
    </div>
  )
}
