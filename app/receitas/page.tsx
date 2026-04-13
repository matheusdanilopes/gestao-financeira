'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, subMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import BottomNav from '@/components/BottomNav'
import ReceitasMensal from '@/components/ReceitasMensal'

export default function ReceitasPage() {
  const [mesAtual, setMesAtual] = useState(new Date())

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Gestão de Receitas</h1>

      <div className="flex items-center justify-between bg-white rounded-xl shadow p-3 mb-6">
        <button onClick={() => setMesAtual(subMonths(mesAtual, 1))} className="p-2 hover:bg-gray-100 rounded-full">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-lg font-semibold">{format(mesAtual, 'MMMM yyyy', { locale: ptBR })}</span>
        <button onClick={() => setMesAtual(addMonths(mesAtual, 1))} className="p-2 hover:bg-gray-100 rounded-full">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <ReceitasMensal mesSelecionado={mesAtual} />
      <BottomNav />
    </div>
  )
}
