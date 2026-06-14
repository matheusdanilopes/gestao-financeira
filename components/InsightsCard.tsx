'use client'

import { Sparkles, RefreshCw, Clock, ArrowRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { useInsights } from '@/lib/useInsights'
import type { InsightItem } from '@/lib/insightsTypes'

const NIVEL_BAR: Record<InsightItem['nivel'], string> = {
  alerta:   'bg-amber-400',
  positivo: 'bg-emerald-400',
  info:     'bg-blue-400',
  sugestao: 'bg-violet-400',
}

const NIVEL_REC: Record<InsightItem['nivel'], string> = {
  alerta:   'text-amber-500',
  positivo: 'text-emerald-500',
  info:     'text-blue-500',
  sugestao: 'text-violet-500',
}

function InsightRow({ item }: { item: InsightItem }) {
  const bar = NIVEL_BAR[item.nivel]
  const recColor = NIVEL_REC[item.nivel]
  const router = useRouter()
  const isClickable = !!item.action

  const handleClick = () => {
    if (item.action) router.push(item.action.route)
  }

  return (
    <div
      className={`flex rounded-2xl bg-white border border-gray-100
                  shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden
                  ${isClickable
                    ? 'cursor-pointer transition-all duration-200 ease-smooth hover:shadow-[0_2px_10px_rgba(0,0,0,0.07)] hover:border-gray-200 active:scale-[0.99]'
                    : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } } : undefined}
    >
      {/* Left accent bar */}
      <div className={`w-[3px] shrink-0 ${bar}`} />

      <div className="flex-1 px-3.5 py-3 min-w-0">
        {/* Title row */}
        <div className="flex items-start gap-2.5">
          <span className="text-[17px] leading-none shrink-0 mt-px">{item.icone}</span>
          <p className="text-sm font-semibold text-gray-800 leading-snug flex-1">
            {item.titulo}
          </p>
          {isClickable && (
            <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
          )}
        </div>

        {/* Metric detail */}
        {item.detalhe && (
          <p className="text-xs text-gray-400 leading-snug mt-1.5 ml-[27px]">
            {item.detalhe}
          </p>
        )}

        {/* Recommendation */}
        {item.recomendacao && (
          <p className={`text-[11px] leading-snug mt-1.5 ml-[27px] font-medium ${recColor}`}>
            {item.recomendacao}
          </p>
        )}
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex rounded-2xl bg-white border border-gray-100 overflow-hidden">
      <div className="w-[3px] shrink-0 bg-gray-200" />
      <div className="flex-1 px-3.5 py-3 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full skeleton shrink-0" />
          <div className="h-4 skeleton rounded-lg w-3/5" />
        </div>
        <div className="ml-[27px] h-3 skeleton rounded-lg w-4/5" />
        <div className="ml-[27px] h-3 skeleton rounded-lg w-2/5" />
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

  const isLoading  = status === 'loading'
  const isUpdating = status === 'updating'
  const isError    = status === 'error'
  const hasContent = insights.length > 0

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 leading-none">
              Insights por IA
            </h2>
            {isUpdating ? (
              <p className="text-[10px] text-violet-400 dark:text-violet-400 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Recalculando…
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
            className="p-1.5 rounded-xl text-gray-300 dark:text-gray-600
                       hover:text-violet-500 dark:hover:text-violet-400
                       hover:bg-violet-50 dark:hover:bg-violet-900/30
                       active:scale-90 transition-all duration-150"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="space-y-2">
        {isLoading && !hasContent ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : isError && !hasContent ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-gray-300" />
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

      {/* Footer */}
      {(updatedAt || isUpdating || refreshFailed) && (
        <div className="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
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
              className="text-[10px] text-amber-500 dark:text-amber-400 font-semibold
                         flex items-center gap-1 shrink-0
                         hover:underline focus:outline-none"
            >
              <RefreshCw className="w-3 h-3" /> Tentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
