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
  alerta:   'text-amber-600 dark:text-amber-400',
  positivo: 'text-emerald-600 dark:text-emerald-400',
  info:     'text-blue-600 dark:text-blue-400',
  sugestao: 'text-violet-600 dark:text-violet-400',
}

const NIVEL_COLORS: Record<InsightItem['nivel'], {
  bg: string; border: string; icon: string; pill: string; hover: string
}> = {
  alerta: {
    bg:     'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-100 dark:border-amber-900/40',
    icon:   'bg-amber-100 dark:bg-amber-900/40',
    pill:   'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    hover:  'hover:border-amber-200 dark:hover:border-amber-800/60 hover:shadow-[0_2px_10px_rgba(245,158,11,0.12)]',
  },
  positivo: {
    bg:     'bg-emerald-50 dark:bg-emerald-950/20',
    border: 'border-emerald-100 dark:border-emerald-900/40',
    icon:   'bg-emerald-100 dark:bg-emerald-900/40',
    pill:   'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    hover:  'hover:border-emerald-200 dark:hover:border-emerald-800/60 hover:shadow-[0_2px_10px_rgba(16,185,129,0.12)]',
  },
  info: {
    bg:     'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-100 dark:border-blue-900/40',
    icon:   'bg-blue-100 dark:bg-blue-900/40',
    pill:   'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    hover:  'hover:border-blue-200 dark:hover:border-blue-800/60 hover:shadow-[0_2px_10px_rgba(59,130,246,0.12)]',
  },
  sugestao: {
    bg:     'bg-violet-50 dark:bg-violet-950/20',
    border: 'border-violet-100 dark:border-violet-900/40',
    icon:   'bg-violet-100 dark:bg-violet-900/40',
    pill:   'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
    hover:  'hover:border-violet-200 dark:hover:border-violet-800/60 hover:shadow-[0_2px_10px_rgba(139,92,246,0.12)]',
  },
}

function InsightRow({ item, index }: { item: InsightItem; index: number }) {
  const colors = NIVEL_COLORS[item.nivel]
  const router = useRouter()
  const isClickable = !!item.action

  const handleClick = () => {
    if (item.action) router.push(item.action.route)
  }

  return (
    <div
      className={`list-item-enter flex rounded-2xl ${colors.bg} ${colors.border} border overflow-hidden
                  transition-all duration-200
                  ${isClickable
                    ? `cursor-pointer ${colors.hover} active:scale-[0.99]`
                    : ''}`}
      style={{ animationDelay: `${index * 70}ms` }}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } } : undefined}
    >
      {/* Left accent bar */}
      <div className={`w-1 shrink-0 ${NIVEL_BAR[item.nivel]}`} />

      <div className="flex-1 px-3.5 py-3 min-w-0">
        {/* Title row */}
        <div className="flex items-start gap-2.5">
          <span className={`w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-base leading-none ${colors.icon}`}>
            {item.icone}
          </span>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug flex-1">
            {item.titulo}
          </p>
        </div>

        {/* Metric detail */}
        {item.detalhe && (
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mt-1.5 ml-[37px]">
            {item.detalhe}
          </p>
        )}

        {/* Recommendation */}
        {item.recomendacao && (
          <p className={`text-[11px] leading-snug mt-1 ml-[37px] font-medium ${NIVEL_REC[item.nivel]}`}>
            {item.recomendacao}
          </p>
        )}

        {/* Action pill */}
        {item.action && (
          <div className="mt-2 ml-[37px]">
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2.5 py-1 ${colors.pill}`}>
              {item.action.label}
              <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/40 overflow-hidden">
      <div className="w-1 shrink-0 bg-gray-200 dark:bg-gray-700" />
      <div className="flex-1 px-3.5 py-3 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl skeleton shrink-0" />
          <div className="h-4 skeleton rounded-lg w-3/5" />
        </div>
        <div className="ml-[37px] h-3 skeleton rounded-lg w-4/5" />
        <div className="ml-[37px] h-3 skeleton rounded-lg w-2/5" />
        <div className="ml-[37px] mt-1 h-5 w-24 skeleton rounded-full" />
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
    <div className={`relative bg-white dark:bg-gray-900 rounded-3xl shadow-card border transition-colors duration-300 p-4 overflow-hidden
                     ${isUpdating
                       ? 'border-violet-200 dark:border-violet-800/60'
                       : 'border-gray-100 dark:border-gray-800'}`}>

      {/* Top progress bar when updating */}
      {isUpdating && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-violet-400 to-transparent animate-pulse" />
      )}

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
      <div className={`space-y-2 ${hasContent ? 'content-enter' : ''}`}>
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
          insights.map((item, i) => <InsightRow key={i} item={item} index={i} />)
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
