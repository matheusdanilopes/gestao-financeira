'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useOnline } from '@/lib/useOnline'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import BottomNav from '@/components/BottomNav'
import InvestimentosMensal from '@/components/InvestimentosMensal'
import { useMes } from '@/components/MesProvider'

async function calcularSaldo(mes: Date): Promise<{ saldo: number; saldoPrevisto: number }> {
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

  const NUBANK_ITEMS = new Set(['NuBank Matheus', 'NuBank Jeniffer', 'NuBank Jeniffer Conjunto'])
  const contasFixas = (planejamento || [])
    .filter(p => {
      const item = typeof p.item === 'string' ? p.item : ''
      return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
        && !NUBANK_ITEMS.has(item)
        && !item.startsWith('[CARTAO1]') && !item.startsWith('[CARTAO2]')
    })
    .reduce((acc, p) => acc + (p.pago ? (p.valor_real ?? p.valor_previsto) : p.valor_previsto), 0)

  const contasFixasPrevisto = (planejamento || [])
    .filter(p => {
      const item = typeof p.item === 'string' ? p.item : ''
      return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
        && !NUBANK_ITEMS.has(item)
        && !item.startsWith('[CARTAO1]') && !item.startsWith('[CARTAO2]')
    })
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

  const matheusPrevisto = planejamento?.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (planejamento?.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) +
    (planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)
  const nuBankPrevisto = matheusPrevisto + jenifferPrevisto

  const cartao1PrevTotal = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)
  const cartao2PrevTotal = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

  const temLancamentos = totalRealizado > 0
  const faturaEfetiva = temLancamentos
    ? totalRealizado
    : nuBankPrevisto + cartao1PrevTotal + cartao2PrevTotal
  const totalGastos = contasFixas + faturaEfetiva

  const saldo = receitaTotal - totalGastos
  const saldoPrevisto = receitaTotal - contasFixasPrevisto - nuBankPrevisto - cartao1PrevTotal - cartao2PrevTotal

  return { saldo, saldoPrevisto }
}

export default function InvestimentosPage() {
  const { mesAtual, setMesAtual } = useMes()
  const [saldo, setSaldo] = useState(0)
  const [saldoPrevisto, setSaldoPrevisto] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const isOnline = useOnline()

  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  useEffect(() => {
    if (!isOnline) {
      setCarregando(false)
      return
    }
    setCarregando(true)
    calcularSaldo(mesAtual)
      .then(({ saldo: s, saldoPrevisto: sp }) => { setSaldo(s); setSaldoPrevisto(sp); setCarregando(false) })
      .catch(() => setCarregando(false))
  }, [mesAtual, isOnline])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      {/* Header + filtro de mês */}
      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-3">Investimentos</h1>
        <div className="flex items-center justify-between bg-white rounded-2xl shadow-card border border-gray-100 px-2 py-1">
          <button
            onClick={() => setMesAtual(subMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors active:scale-95"
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

      {carregando ? (
        <div className="bg-white rounded-3xl shadow-card p-6 animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/2" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 bg-gray-200 rounded-xl" />
            <div className="h-20 bg-gray-200 rounded-xl" />
          </div>
          <div className="h-2 bg-gray-200 rounded-full" />
        </div>
      ) : (
        <InvestimentosMensal mesSelecionado={mesAtual} saldo={saldo} saldoPrevisto={saldoPrevisto} />
      )}

      <BottomNav />
    </div>
  )
}
