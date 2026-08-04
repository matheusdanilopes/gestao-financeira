'use client'

import { useEffect, useState } from 'react'
import MonthSelector from '@/components/MonthSelector'
import ParcelamentosMensal from '@/components/ParcelamentosMensal'
import InsightsParcelamentosCard from '@/components/InsightsParcelamentosCard'
import ProjecaoParcelamentosCard from '@/components/parcelamentos/ProjecaoParcelamentosCard'
import SimuladorParcelamento from '@/components/parcelamentos/SimuladorParcelamento'
import { useMes } from '@/components/MesProvider'
import { InfoPopover } from '@/components/InfoPopover'
import { buscarRelatorioCartoes, type RelatorioCartoes } from '@/lib/relatorioCartoes'

export default function ParcelamentosPage() {
  const { mesAtual, setMesAtual } = useMes()
  const [relatorio, setRelatorio] = useState<RelatorioCartoes | null>(null)

  useEffect(() => {
    let cancelado = false
    // Mantém o relatório do mês anterior visível até o novo chegar (stale-while-
    // revalidate), em vez de zerar e piscar um estado vazio a cada troca de mês.
    buscarRelatorioCartoes(mesAtual)
      .then(dados => { if (!cancelado) setRelatorio(dados) })
      .catch(() => { if (!cancelado) setRelatorio(null) })
    return () => { cancelado = true }
  }, [mesAtual])

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-1.5">
          Parcelamentos
          <InfoPopover texto="Apoio estratégico para gerir suas compras parceladas: insights por IA, projeção dos próximos meses, um simulador para testar uma compra antes de parcelar, e o controle de limite mensal por pessoa. Se um mês não tiver limite próprio, ele herda o valor do mês anterior configurado, e você pode alterá-lo livremente sem afetar o histórico." />
        </h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content space-y-4">
        <InsightsParcelamentosCard />
        <ProjecaoParcelamentosCard mesAtual={mesAtual} relatorio={relatorio} />
        <SimuladorParcelamento relatorio={relatorio} />
        <ParcelamentosMensal mesAtual={mesAtual} />
      </div>
    </div>
  )
}
