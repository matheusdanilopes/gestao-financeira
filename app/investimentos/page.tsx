'use client'

import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'
import InvestimentosMensal from '@/components/InvestimentosMensal'
import MonthSelector from '@/components/MonthSelector'
import { useMes } from '@/components/MesProvider'
import { useDataSync } from '@/lib/useDataSync'

interface SaldoData {
  saldo: number
  saldoPrevisto: number
}

async function calcularSaldo(mes: Date): Promise<SaldoData> {
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

  return {
    saldo: receitaTotal - totalGastos,
    saldoPrevisto: receitaTotal - contasFixasPrevisto - nuBankPrevisto - cartao1PrevTotal - cartao2PrevTotal,
  }
}

export default function InvestimentosPage() {
  const { mesAtual, setMesAtual } = useMes()
  const [saldo, setSaldo] = useState(0)
  const [saldoPrevisto, setSaldoPrevisto] = useState(0)

  const fetcher = useCallback(() => calcularSaldo(mesAtual), [mesAtual])

  const { status } = useDataSync({
    cacheKey: `investimentos-saldo:${format(mesAtual, 'yyyy-MM')}`,
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
          <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-6 animate-pulse space-y-3">
            <div className="h-5 bg-gray-100 rounded-xl w-1/2" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-20 bg-gray-100 rounded-2xl" />
              <div className="h-20 bg-gray-100 rounded-2xl" />
            </div>
            <div className="h-2 bg-gray-100 rounded-full" />
          </div>
        ) : (
          <InvestimentosMensal mesSelecionado={mesAtual} saldo={saldo} saldoPrevisto={saldoPrevisto} />
        )}
      </div>
    </div>
  )
}
