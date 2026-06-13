'use client'

import { Sparkles, RefreshCw, Clock, ChevronRight, ArrowRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { useInsights } from '@/lib/useInsights'
import type { InsightItem } from '@/lib/insightsTypes'

const NIVEL_CONFIG: Record<InsightItem['nivel'], {
  bar: string; bg: string; titleColor: string; detailColor: string; recColor: string; recBg: string
}> = {
  alerta: {
    bar: 'bg-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    titleColor: 'text-amber-900 dark:text-amber-200',
    detailColor: 'text-amber-700 dark:text-amber-300',
    recColor: 'text-amber-600 dark:text-amber-400',
    recBg: 'bg-amber-100/60 dark:bg-amber-900/30',
  },
  positivo: {
    bar: 'bg-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    titleColor: 'text-emerald-900 dark:text-emerald-200',
    detailColor: 'text-emerald-700 dark:text-emerald-300',
    recColor: 'text-emerald-600 dark:text-emerald-400',
    recBg: 'bg-emerald-100/60 dark:bg-emerald-900/30',
  },
  info: {
    bar: 'bg-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    titleColor: 'text-blue-900 dark:text-blue-200',
    detailColor: 'text-blue-700 dark:text-blue-300',
    recColor: 'text-blue-600 dark:text-blue-400',
    recBg: 'bg-blue-100/60 dark:bg-blue-900/30',
  },
  sugestao: {
    bar: 'bg-violet-400',
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    titleColor: 'text-violet-900 dark:text-violet-200',
    detailColor: 'text-violet-700 dark:text-violet-300',
    recColor: 'text-violet-600 dark:text-violet-400',
    recBg: 'bg-violet-100/60 dark:bg-violet-900/30',
  },
}

function InsightRow({ item }: { item: InsightItem }) {
  const c = NIVEL_CONFIG[item.nivel]
  const router = useRouter()
  const isClickable = !!item.action

  const handleClick = () => {
    if (item.action) router.push(item.action.route)
  }

  return (
    <div
      className={`rounded-2xl overflow-hidden ${c.bg}
                  ${isClickable
                    ? 'cursor-pointer transition-all duration-150 ease-smooth hover:brightness-[0.97] dark:hover:brightness-110 hover:shadow-card-md active:scale-[0.99]'
                    : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } } : undefined}
    >
      {/* Top bar accent */}
      <div className={`h-[3px] w-full ${c.bar}`} />

      <div className="px-3.5 pt-3 pb-2.5">
        {/* Title row */}
        <div className="flex items-start gap-2.5 mb-1.5">
          <span className="text-[18px] leading-none mt-0.5 shrink-0">{item.icone}</span>
          <p className={`text-sm font-semibold leading-snug flex-1 ${c.titleColor}`}>
            {item.titulo}
          </p>
          {isClickable && (
            <ArrowRight className={`w-3.5 h-3.5 ml-1 mt-0.5 shrink-0 opacity-50 transition-transform duration-150 group-hover:translate-x-0.5 ${c.titleColor}`} />
          )}
        </div>

        {/* Metric detail */}
        {item.detalhe && (
          <p className={`text-xs leading-snug ml-[34px] mb-2 ${c.detailColor}`}>
            {item.detalhe}
          </p>
        )}

        {/* Recommendation */}
        {item.recomendacao && (
          <div className={`ml-[34px] flex items-start gap-1.5 rounded-xl px-2.5 py-1.5 ${c.recBg}`}>
            <ChevronRight className={`w-3 h-3 mt-0.5 shrink-0 ${c.recColor}`} />
            <p className={`text-[11px] leading-snug font-medium ${c.recColor}`}>
              {item.recomendacao}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-800/60">
      <div className="h-[3px] w-full bg-gray-200 dark:bg-gray-700" />
      <div className="px-3.5 pt-3 pb-3 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full skeleton shrink-0" />
          <div className="h-4 skeleton rounded-lg w-3/5" />
        </div>
        <div className="ml-[34px] h-3 skeleton rounded-lg w-4/5" />
        <div className="ml-[34px] h-7 skeleton rounded-xl w-full" />
      </div>
    </div>
  )
}

function formatUpdatedAt(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 5 * 60_000) {
    return `às ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  return formatDistanceToNow(date, { locale: ptBR, addSuffix: true })
}

export default function InsightsCard() {
  const { insights, updatedAt, status, refreshFailed, refresh } = useInsights()

  const isLoading = status === 'loading'
  const isUpdating = status === 'updating'
  const isError = status === 'error'
  const hasContent = insights.length > 0

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 leading-none">
              Insights por IA
            </h2>
            {isUpdating ? (
              <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Recalculando com seus dados…
              </p>
            ) : (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                Baseado nas suas movimentações
              </p>
            )}
          </div>
        </div>

        {!isLoading && !isUpdating && (
          <button
            onClick={refresh}
            aria-label="Atualizar insights"
            className="p-1.5 rounded-xl text-gray-400 dark:text-gray-500
                       hover:text-violet-600 dark:hover:text-violet-400
                       hover:bg-violet-50 dark:hover:bg-violet-900/30
                       active:scale-90 transition-all duration-150"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="space-y-2.5">
        {isLoading && !hasContent ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : isError && !hasContent ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm text-gray-400 text-center text-balance">
              Não foi possível gerar os insights agora.
            </p>
            <button
              onClick={refresh}
              className="text-xs text-violet-600 dark:text-violet-400 font-semibold
                         flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                         bg-violet-50 dark:bg-violet-900/30
                         hover:bg-violet-100 dark:hover:bg-violet-900/50
                         transition-colors duration-150"
            >
              <RefreshCw className="w-3 h-3" /> Tentar novamente
            </button>
          </div>
        ) : hasContent ? (
          insights.map((item, i) => <InsightRow key={i} item={item} />)
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6 text-balance">
            Nenhum dado disponível para análise
          </p>
        )}
      </div>

      {/* Footer — timestamp + transparência da IA */}
      {(updatedAt || isUpdating || refreshFailed) && (
        <div className="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Clock className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" aria-hidden="true" />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {isUpdating && !updatedAt
                ? 'Analisando suas movimentações…'
                : updatedAt
                ? `Atualizado ${formatUpdatedAt(updatedAt)}`
                : 'Atualizando…'}
            </p>
          </div>
          {refreshFailed && !isUpdating && (
            <button
              onClick={refresh}
              className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold
                         flex items-center gap-1 shrink-0
                         hover:underline focus:outline-none"
            >
              <RefreshCw className="w-3 h-3" /> Falhou — tentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
