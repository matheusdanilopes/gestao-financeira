'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import MonthSelector from '@/components/MonthSelector'
import { useMes } from '@/components/MesProvider'

// ── Skeletons por contexto de cada tab ──────────────────────────────────────

function SkeletonDespesas() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="h-16 bg-gray-100 rounded-2xl" />
          <div className="h-16 bg-gray-100 rounded-2xl" />
          <div className="h-16 bg-gray-100 rounded-2xl" />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-3 bg-gray-100 rounded-full w-24" />
            <div className="h-3 bg-gray-100 rounded-full w-8" />
          </div>
          <div className="h-2 bg-gray-100 rounded-full" />
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <div className="h-4 bg-gray-100 rounded-full w-24" />
          </div>
          <div className="divide-y divide-gray-100">
            {[1, 2].map((j) => (
              <div key={j} className="px-4 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-gray-100 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-gray-100 rounded-full w-3/4" />
                  <div className="h-3 bg-gray-100 rounded-full w-1/3" />
                </div>
                <div className="h-4 bg-gray-100 rounded-full w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkeletonReceitas() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-gray-100 rounded-lg shrink-0" />
          <div className="h-4 bg-gray-100 rounded-full w-40" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-3 bg-gray-100 rounded-full w-28" />
            <div className="h-3 bg-gray-100 rounded-full w-8" />
          </div>
          <div className="h-2 bg-gray-100 rounded-full" />
        </div>
      </div>
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3 border-b border-gray-100 last:border-b-0">
            <div className="w-2 h-2 rounded-full bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-gray-100 rounded-full w-2/3" />
              <div className="h-2 bg-gray-100 rounded-full w-full" />
            </div>
            <div className="h-4 bg-gray-100 rounded-full w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonInvestimentos() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-gray-100 rounded-lg shrink-0" />
          <div className="h-4 bg-gray-100 rounded-full w-48" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
          <div className="h-20 bg-gray-100 rounded-2xl" />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-3 bg-gray-100 rounded-full w-32" />
            <div className="h-3 bg-gray-100 rounded-full w-8" />
          </div>
          <div className="h-2 bg-gray-100 rounded-full" />
        </div>
      </div>
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-b-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-gray-100 rounded-full w-2/3" />
                <div className="h-3 bg-gray-100 rounded-full w-1/3" />
              </div>
              <div className="h-4 bg-gray-100 rounded-full w-20 shrink-0" />
            </div>
            <div className="pl-5">
              <div className="h-1.5 bg-gray-100 rounded-full w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Lazy-loaded — cada tab só carrega quando ativada pela primeira vez
const ChecklistMensal = dynamic(() => import('@/components/ChecklistMensal'), {
  ssr: false,
  loading: () => <SkeletonDespesas />,
})
const ReceitasMensal = dynamic(() => import('@/components/ReceitasMensal'), {
  ssr: false,
  loading: () => <SkeletonReceitas />,
})
const InvestimentosMensal = dynamic(() => import('@/components/InvestimentosMensal'), {
  ssr: false,
  loading: () => <SkeletonInvestimentos />,
})

import { useDataSync } from '@/lib/useDataSync'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'

function isNuBankItem(item: string): boolean {
  const lower = item.trim().toLowerCase()
  return lower === 'nubank matheus' || lower === 'nubank jeniffer' ||
         lower === 'nubank jeniffer conjunto' || lower === 'nubank conjunto'
}

type Tab = 'despesas' | 'receitas' | 'investimentos'

interface SaldoData { saldo: number; saldoPrevisto: number }

async function calcularSaldo(mes: Date): Promise<SaldoData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [{ data: transacoesFatura }, { data: planejamento }] = await Promise.all([
    supabase.from('transacoes_nubank').select('valor, responsavel, cartao').eq('projeto_fatura', mesRefFatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO'),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
  ])

  function findNuBank(name: string) {
    return planejamento?.find((p: { item: string }) => p.item.trim().toLowerCase() === name)
  }

  const txNubank = (transacoesFatura || []).filter(t => !t.cartao || t.cartao === 'nubank')
  const txC1 = (transacoesFatura || []).filter(t => t.cartao === 'cartao1')
  const txC2 = (transacoesFatura || []).filter(t => t.cartao === 'cartao2')

  const receitaBase = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
  const receitasExtras = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[RECEITA]'))
    .reduce((acc, p) => acc + p.valor_previsto, 0)
  const receitaTotal = receitaBase + receitasExtras

  let contasFixas = 0
  let contasFixasPrevisto = 0
  for (const p of (planejamento || [])) {
    const item = typeof p.item === 'string' ? p.item : ''
    if (item.startsWith('[RECEITA]') || item === 'Receita Total' ||
        isNuBankItem(item) || item.startsWith('[CARTAO1]') || item.startsWith('[CARTAO2]')) continue
    const prev = p.valor_previsto || 0
    contasFixas += p.pago ? (p.valor_real ?? prev) : prev
    contasFixasPrevisto += prev
  }

  const matheusPrevisto = findNuBank('nubank matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (findNuBank('nubank jeniffer')?.valor_previsto || 0) +
    (findNuBank('nubank jeniffer conjunto')?.valor_previsto || 0)
  const conjuntoPrevisto = findNuBank('nubank conjunto')?.valor_previsto || 0
  const nuBankPrevisto = matheusPrevisto + jenifferPrevisto + conjuntoPrevisto

  const cartao1PrevTotal = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)
  const cartao2PrevTotal = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

  const nubankMatheusRow = findNuBank('nubank matheus')
  const nubankJenifferRow = findNuBank('nubank jeniffer')
  const nubankJenifferConjRow = findNuBank('nubank jeniffer conjunto')
  const nubankConjuntoRow = findNuBank('nubank conjunto')

  const matheusAtual = txNubank.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0)
  const jenifferAtual = txNubank.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0)
  const conjuntoAtual = txNubank.filter(t => t.responsavel === 'Conjunto').reduce((acc, t) => acc + t.valor, 0)
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

  const conjuntoEfetivo = nubankConjuntoRow?.pago
    ? (nubankConjuntoRow.valor_real ?? conjuntoPrevisto)
    : conjuntoAtual > 0 ? conjuntoAtual : conjuntoPrevisto
  const faturaEfetiva = nubankMatheusEfetivo + nubankJenifferEfetivo + conjuntoEfetivo + cartao1Efetivo + cartao2Efetivo
  const totalGastos = contasFixas + faturaEfetiva

  return {
    saldo: receitaTotal - totalGastos,
    saldoPrevisto: receitaTotal - contasFixasPrevisto - nuBankPrevisto - cartao1PrevTotal - cartao2PrevTotal,
  }
}

// ── Configuração visual das tabs ─────────────────────────────────────────────

const TAB_CONFIG: Record<Tab, { label: string; activeClass: string; dotClass: string }> = {
  despesas:      { label: 'Despesas',      activeClass: 'bg-red-500 text-white shadow-sm',    dotClass: 'bg-red-400' },
  receitas:      { label: 'Receitas',      activeClass: 'bg-emerald-500 text-white shadow-sm', dotClass: 'bg-emerald-400' },
  investimentos: { label: 'Investimentos', activeClass: 'bg-violet-600 text-white shadow-sm',  dotClass: 'bg-violet-400' },
}

function FinancasContent() {
  const searchParams = useSearchParams()
  const [abaAtual, setAbaAtual] = useState<Tab>('despesas')
  const { mesAtual, setMesAtual } = useMes()

  // Sincroniza a tab com o parâmetro da URL sempre que a navegação mudar
  useEffect(() => {
    const tab = searchParams.get('tab') as Tab | null
    if (tab === 'receitas' || tab === 'investimentos' || tab === 'despesas') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAbaAtual(tab)
    } else {
      setAbaAtual('despesas')
    }
  }, [searchParams])

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

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10] space-y-3">
        {/* Título + seletor de mês */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-3">
            {TAB_CONFIG[abaAtual].label}
          </h1>
          <MonthSelector value={mesAtual} onChange={setMesAtual} />
        </div>

        {/* Tab bar */}
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-1 flex gap-1" role="tablist">
          {(Object.keys(TAB_CONFIG) as Tab[]).map((tab) => {
            const cfg = TAB_CONFIG[tab]
            const isActive = abaAtual === tab
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={isActive}
                aria-label={cfg.label}
                onClick={() => setAbaAtual(tab)}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl
                  text-xs font-semibold transition-all duration-200 ease-smooth
                  tap-scale active:scale-[0.96] min-h-[40px]
                  ${isActive
                    ? cfg.activeClass
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}
                `}
              >
                {isActive && (
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass} opacity-80 shrink-0`} />
                )}
                <span className="truncate">{cfg.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="page-content">
        {abaAtual === 'despesas' && (
          <div key="despesas" className="tab-content-enter">
            <ChecklistMensal mesSelecionado={mesAtual} />
          </div>
        )}
        {abaAtual === 'receitas' && (
          <div key="receitas" className="tab-content-enter">
            <ReceitasMensal mesSelecionado={mesAtual} />
          </div>
        )}
        {abaAtual === 'investimentos' && (
          <div key="investimentos" className="tab-content-enter">
            {carregandoInvest ? (
              <SkeletonInvestimentos />
            ) : (
              <InvestimentosMensal mesSelecionado={mesAtual} saldo={saldo} saldoPrevisto={saldoPrevisto} />
            )}
          </div>
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
