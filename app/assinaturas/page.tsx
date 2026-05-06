'use client'

import { format, addMonths, subMonths, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import BottomNav from '@/components/BottomNav'
import AssinaturasMensal from '@/components/AssinaturasMensal'
import { useMes } from '@/components/MesProvider'

export default function AssinaturasPage() {
  const { mesAtual, setMesAtual } = useMes()

  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-3">Assinaturas</h1>
        <div className="flex items-center justify-between bg-white rounded-2xl shadow-card border border-gray-100 px-2 py-1">
          <button
            onClick={() => setMesAtual(subMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors active:scale-95"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="text-center flex-1">
            <p className="font-semibold capitalize text-gray-800">
              {format(startOfMonth(mesAtual), 'MMMM yyyy', { locale: ptBR })}
            </p>
            {!isMesAtual && (
              <button
                onClick={() => setMesAtual(new Date())}
                className="text-xs text-primary-600 hover:underline"
              >
                Voltar ao mês atual
              </button>
            )}
          </div>
          <button
            onClick={() => setMesAtual(addMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors active:scale-95"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      <AssinaturasMensal mesSelecionado={mesAtual} />

      <BottomNav />
    </div>
  )
}
