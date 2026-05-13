'use client'

import { Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import MonthSelector from '@/components/MonthSelector'
import ChecklistMensal from '@/components/ChecklistMensal'
import ReceitasMensal from '@/components/ReceitasMensal'
import InvestimentosMensal from '@/components/InvestimentosMensal'
import { useMes } from '@/components/MesProvider'
import { useDataSync } from '@/lib/useDataSync'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'

type Tab = 'despesas' | 'receitas' | 'investimentos'

const TABS: { key: Tab; label: string }[] = [
  { key: 'despesas',      label: 'Despesas' },
  { key: 'receitas',      label: 'Receitas' },
  { key: 'investimentos', label: 'Investimentos' },
]

interface SaldoData { saldo: number; saldoPrevisto: number }

async function calcularSaldo(mes: Date): Promise<SaldoData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [{ data: transacoesFatura }, { data: planejamento }] = await Promise.all([
    supabase.from('transacoes_nubank').select('valor, responsavel, cartao').eq('projeto_fatura', mesRefFatura),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
  ])

  const txNubank = (transacoesFatura || []).filter(t => !t.cartao || t.cartao === 'nubank')
  const txC1 = (transacoesFatura || []).filter(t => t.cartao === 'cartao1')
  const txC2 = (transacoesFatura || []).filter(t => t.cartao === 'cartao2')

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

  const nubankMatheusRow = planejamento?.find(p => p.item === 'NuBank Matheus')
  const nubankJenifferRow = planejamento?.find(p => p.item === 'NuBank Jeniffer')
  const nubankJenifferConjRow = planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')

  const matheusAtual = txNubank.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0)
  const jenifferAtual = txNubank.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0)
  const totalC1Atual = txC1.reduce((acc, t) => acc + t.valor, 0)
  const totalC2Atual = txC2.reduce((acc, t) => acc + t.valor, 0)

  const nubankMatheusEfetivo = nubankMatheusRow?.pago
    ? (nubankMatheusRow.valor_real ?? nubankMatheusRow.valor_previsto)
    : matheusAtual > 0 ? matheusAtual : matheusPrevisto

  const jenifferNubankPago = !!(nubankJenifferRow?.pago || nubankJenifferConjRow?.pago)
  const nubankJenifferEfetivo = jenifferNubankPago
    ? ((nubankJenifferRow?.pago ? (nubankJenifferRow.valor_real ?? nubankJenifferRow.valor_previsto) : 0) +
       (nubankJenifferConjRow?.pago ? (nubankJenifferConjRow.valor_real ?? nubankJenifferConjRow.valor_previsto) : 0))
    : jenifferAtual > 0 ? jenifferAtual : jenifferPrevisto

  const cartao1PaidRows = (planejamento || []).filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]') && p.pago)
  const cartao1Efetivo = cartao1PaidRows.length > 0
    ? cartao1PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : totalC1Atual > 0 ? totalC1Atual : cartao1PrevTotal

  const cartao2PaidRows = (planejamento || []).filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]') && p.pago)
  const cartao2Efetivo = cartao2PaidRows.length > 0
    ? cartao2PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : totalC2Atual > 0 ? totalC2Atual : cartao2PrevTotal

  const faturaEfetiva = nubankMatheusEfetivo + nubankJenifferEfetivo + cartao1Efetivo + cartao2Efetivo
  const totalGastos = contasFixas + faturaEfetiva

  return {
    saldo: receitaTotal - totalGastos,
    saldoPrevisto: receitaTotal - contasFixasPrevisto - nuBankPrevisto - cartao1PrevTotal - cartao2PrevTotal,
  }
}

function FinancasContent() {
  const searchParams = useSearchParams()
  const [abaAtual, setAbaAtual] = useState<Tab>(() => {
    const tab = searchParams.get('tab')
    return (tab === 'receitas' || tab === 'investimentos') ? tab : 'despesas'
  })
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

  const carregandoInvest = status === 'loading'

  const titulos: Record<Tab, string> = {
    despesas:      'Despesas',
    receitas:      'Receitas',
    investimentos: 'Investimentos',
  }

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3">{titulos[abaAtual]}</h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />

        {/* Segmented Control */}
        <div
          role="tablist"
          aria-label="Seção financeira"
          className="flex gap-1 mt-3 p-1 bg-gray-100 rounded-2xl"
        >
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={abaAtual === key}
              onClick={() => setAbaAtual(key)}
              className={`flex-1 py-1.5 rounded-xl text-sm font-semibold transition-all duration-200
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                          ${abaAtual === key
                            ? 'bg-white text-primary-700 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                          }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        {abaAtual === 'despesas' && (
          <ChecklistMensal mesSelecionado={mesAtual} />
        )}
        {abaAtual === 'receitas' && (
          <ReceitasMensal mesSelecionado={mesAtual} />
        )}
        {abaAtual === 'investimentos' && (
          carregandoInvest ? (
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
          )
        )}
      </div>
    </div>
  )
}

export default function FinancasPage() {
  return (
    <Suspense>
      <FinancasContent />
    </Suspense>
  )
}
