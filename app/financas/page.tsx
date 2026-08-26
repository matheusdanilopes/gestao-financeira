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
import { format } from 'date-fns'
import { calcularSaldoInvestimentos } from '@/lib/calcularSaldoInvestimentos'

type Tab = 'despesas' | 'receitas' | 'investimentos'

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

  const fetcher = useCallback(() => calcularSaldoInvestimentos(mesAtual), [mesAtual])
  const { status } = useDataSync({
    cacheKey: `investimentos-saldo:financas:${format(mesAtual, 'yyyy-MM')}`,
    tables: ['transacoes_nubank', 'planejamento'],
    fetcher,
    onData: (data: unknown) => {
      const d = data as { saldo: number; saldoPrevisto: number }
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
          <h1 className="font-display italic text-xl font-semibold text-gray-900 mb-3">
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
