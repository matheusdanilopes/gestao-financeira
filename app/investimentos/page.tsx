'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import BottomNav from '@/components/BottomNav'
import InvestimentosMensal from '@/components/InvestimentosMensal'
import { useMes } from '@/components/MesProvider'

async function calcularSaldo(mes: Date): Promise<number> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [{ data: transacoesFatura }, { data: planejamento }] = await Promise.all([
    supabase.from('transacoes_nubank').select('valor, responsavel').eq('projeto_fatura', mesRefFatura),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
  ])

  const totalRealizado = transacoesFatura?.reduce((acc, t) => acc + t.valor, 0) || 0

  const receitaBase = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
  const receitasExtras = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[RECEITA]'))
    .reduce((acc, p) => acc + p.valor_previsto, 0)
  const receitaTotal = receitaBase + receitasExtras

  const totalPlanejado = (planejamento || [])
    .filter(p => {
      const item = typeof p.item === 'string' ? p.item : ''
      return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
    })
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

  const matheusPrevisto = planejamento?.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (planejamento?.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) +
    (planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)
  const nuBankPrevisto = matheusPrevisto + jenifferPrevisto

  const faturaEfetiva = totalRealizado === 0 ? nuBankPrevisto : totalRealizado
  const totalGastos = totalPlanejado - nuBankPrevisto + faturaEfetiva

  return receitaTotal - totalGastos
}

export default function InvestimentosPage() {
  const { mesAtual, setMesAtual } = useMes()
  const [saldo, setSaldo] = useState(0)
  const [carregando, setCarregando] = useState(true)

  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  useEffect(() => {
    setCarregando(true)
    calcularSaldo(mesAtual).then(s => {
      setSaldo(s)
      setCarregando(false)
    })
  }, [mesAtual])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      {/* Header + filtro de mês */}
      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-3">Investimentos</h1>
        <div className="flex items-center justify-between bg-white rounded-xl shadow-sm px-2 py-1">
          <button
            onClick={() => setMesAtual(subMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="text-center flex-1">
            <p className="font-semibold capitalize text-gray-800">
              {format(mesAtual, 'MMMM yyyy', { locale: ptBR })}
            </p>
            {!isMesAtual && (
              <button
                onClick={() => setMesAtual(new Date())}
                className="text-xs text-blue-500 hover:underline"
              >
                Voltar ao mês atual
              </button>
            )}
          </div>
          <button
            onClick={() => setMesAtual(addMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {carregando ? (
        <div className="bg-white rounded-2xl shadow p-6 animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/2" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 bg-gray-200 rounded-xl" />
            <div className="h-20 bg-gray-200 rounded-xl" />
          </div>
          <div className="h-2 bg-gray-200 rounded-full" />
        </div>
      ) : (
        <InvestimentosMensal mesSelecionado={mesAtual} saldo={saldo} />
      )}

      <BottomNav />
    </div>
  )
}
