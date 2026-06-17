'use client'

import { Sparkles, RefreshCw, Clock, ArrowRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { useInsights } from '@/lib/useInsights'
import type { InsightItem } from '@/lib/insightsTypes'

// Colored left accent bar
const NIVEL_BAR: Record<InsightItem['nivel'], string> = {
  alerta:   'bg-amber-400',
  positivo: 'bg-emerald-500',
  info:     'bg-blue-400',
  sugestao: 'bg-violet-500',
}

// Solid colored circle behind the emoji
const NIVEL_ICON_BG: Record<InsightItem['nivel'], string> = {
  alerta:   'bg-amber-400 text-white',
  positivo: 'bg-emerald-500 text-white',
  info:     'bg-blue-500 text-white',
  sugestao: 'bg-violet-500 text-white',
}

// Ambient glow circle (blurred) — the main "alive" effect
const NIVEL_GLOW: Record<InsightItem['nivel'], string> = {
  alerta:   'bg-amber-300/50 dark:bg-amber-500/20',
  positivo: 'bg-emerald-300/50 dark:bg-emerald-500/20',
  info:     'bg-blue-300/50 dark:bg-blue-500/20',
  sugestao: 'bg-violet-300/50 dark:bg-violet-500/20',
}

// Small level badge
const NIVEL_BADGE: Record<InsightItem['nivel'], { cls: string; label: string }> = {
  alerta:   { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',    label: 'Atenção' },
  positivo: { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300', label: 'Positivo' },
  info:     { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300',        label: 'Info' },
  sugestao: { cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300', label: 'Dica' },
}

// Color for highlighted numeric values inside detalhe text
const NIVEL_VALUE: Record<InsightItem['nivel'], string> = {
  alerta:   'text-amber-600 dark:text-amber-400 font-semibold',
  positivo: 'text-emerald-600 dark:text-emerald-400 font-semibold',
  info:     'text-blue-600 dark:text-blue-400 font-semibold',
  sugestao: 'text-violet-600 dark:text-violet-400 font-semibold',
}

// Recommendation line color
const NIVEL_REC: Record<InsightItem['nivel'], string> = {
  alerta:   'text-amber-600 dark:text-amber-400',
  positivo: 'text-emerald-600 dark:text-emerald-400',
  info:     'text-blue-600 dark:text-blue-400',
  sugestao: 'text-violet-600 dark:text-violet-400',
}

// Action pill
const NIVEL_PILL: Record<InsightItem['nivel'], string> = {
  alerta:   'bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60',
  positivo: 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60',
  info:     'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60',
  sugestao: 'bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/60',
}

// Highlights R$ amounts and percentages inside the detalhe string
function DetalheHighlight({ text, colorClass }: { text: string; colorClass: string }) {
  const parts = text.split(/(R\$\s*[\d.,]+(?:\/mês)?|[+-]?\d+(?:[,.]\d+)?%)/g)
  return (
    <>
      {parts.map((part, i) =>
        /R\$|%/.test(part)
          ? <span key={i} className={colorClass}>{part}</span>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

function InsightRow({ item, index, isNew }: { item: InsightItem; index: number; isNew: boolean }) {
  const badge = NIVEL_BADGE[item.nivel]
  const router = useRouter()
  const isClickable = !!item.action

  return (
    <div
      className={`list-item-enter relative rounded-2xl bg-white dark:bg-gray-800/70
                  border border-gray-100 dark:border-gray-700/50 overflow-hidden
                  transition-all duration-200
                  ${isNew ? 'insight-new-flash' : ''}
                  ${isClickable
                    ? 'cursor-pointer hover:shadow-card-md hover:border-gray-200 dark:hover:border-gray-600 active:scale-[0.99]'
                    : ''}`}
      style={{ animationDelay: `${index * 70}ms` }}
      onClick={isClickable ? () => router.push(item.action!.route) : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(item.action!.route) }
      } : undefined}
    >
      {/* Ambient glow — breathes slowly */}
      <div className={`absolute -top-8 -left-8 w-28 h-28 rounded-full blur-2xl pointer-events-none insight-glow-pulse ${NIVEL_GLOW[item.nivel]}`} />

      {/* "NOVO" badge — visible for 6s when content changed */}
      {isNew && (
        <span className="absolute top-2 right-2 z-10 text-[9px] font-black uppercase tracking-widest
                         px-1.5 py-px rounded-full bg-violet-500 text-white badge-fade-in">
          Novo
        </span>
      )}

      {/* Left accent bar */}
      <div className={`absolute top-0 left-0 bottom-0 w-[3px] ${NIVEL_BAR[item.nivel]}`} />

      {/* Content */}
      <div className="relative flex gap-3 pl-5 pr-4 py-3.5 min-w-0">

        {/* Large solid-color emoji circle — floats gently, phase offset per card */}
        <div
          className={`w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center text-xl leading-none shadow-sm insight-float ${NIVEL_ICON_BG[item.nivel]}`}
          style={{ animationDelay: `${index * 0.4}s` }}
        >
          {item.icone}
        </div>

        <div className="flex-1 min-w-0">
          {/* Badge chip */}
          <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-px rounded-md mb-0.5 ${badge.cls}`}>
            {badge.label}
          </span>

          {/* Title */}
          <p className="text-[13px] font-bold text-gray-800 dark:text-gray-100 leading-snug">
            {item.titulo}
          </p>

          {/* Metric detail with highlighted numbers */}
          {item.detalhe && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mt-1">
              <DetalheHighlight text={item.detalhe} colorClass={NIVEL_VALUE[item.nivel]} />
            </p>
          )}

          {/* Recommendation with arrow prefix */}
          {item.recomendacao && (
            <p className={`text-[11px] mt-1 font-medium ${NIVEL_REC[item.nivel]}`}>
              → {item.recomendacao}
            </p>
          )}

          {/* Action pill */}
          {item.action && (
            <span className={`inline-flex items-center gap-1 mt-2 text-[10px] font-bold rounded-full px-3 py-1 ${NIVEL_PILL[item.nivel]}`}>
              {item.action.label} <ArrowRight className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex rounded-2xl bg-white dark:bg-gray-800/70 border border-gray-100 dark:border-gray-700/50 overflow-hidden">
      <div className="w-[3px] shrink-0 bg-gray-200 dark:bg-gray-700" />
      <div className="flex flex-1 gap-3 pl-5 pr-4 py-3.5">
        <div className="w-11 h-11 rounded-2xl skeleton shrink-0" />
        <div className="flex-1 space-y-1.5 pt-0.5">
          <div className="h-3 w-14 skeleton rounded-md" />
          <div className="h-4 skeleton rounded-lg w-3/4" />
          <div className="h-3 skeleton rounded-lg w-full" />
          <div className="h-3 skeleton rounded-lg w-2/3" />
          <div className="h-5 w-24 skeleton rounded-full mt-1" />
        </div>
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
  const { insights, updatedAt, status, refreshFailed, changedIndices, source, fallbackReason, refresh } = useInsights()

  const isLoading  = status === 'loading'
  const isUpdating = status === 'updating'
  const isError    = status === 'error'
  const hasContent = insights.length > 0
  const isFallback = source === 'fallback'

  return (
    <div className={`relative bg-white dark:bg-gray-900 rounded-3xl shadow-card border transition-colors duration-300 p-4 overflow-hidden
                     ${isUpdating
                       ? 'border-violet-200 dark:border-violet-800/60'
                       : 'border-gray-100 dark:border-gray-800'}`}>

      {/* Scanning shimmer bar while recalculating */}
      {isUpdating && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-violet-400 to-transparent animate-pulse" />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                          ${isFallback
                            ? 'bg-amber-50 dark:bg-amber-900/30'
                            : 'bg-violet-50 dark:bg-violet-900/40'}`}>
            <Sparkles className={`w-4 h-4 ${isFallback ? 'text-amber-500 dark:text-amber-400' : 'text-violet-500 dark:text-violet-400'}`} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 leading-none">
              Insights por IA
            </h2>
            {isUpdating ? (
              <p className="text-[10px] text-violet-400 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Recalculando…
              </p>
            ) : isFallback ? (
              <p className="text-[10px] text-amber-500 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="truncate">
                  {fallbackReason?.startsWith('GEMINI_API_KEY')
                    ? 'Chave de IA não configurada'
                    : fallbackReason?.startsWith('QUOTA_429')
                    ? 'Quota da IA esgotada'
                    : fallbackReason?.includes('404')
                    ? 'Modelo não encontrado (404)'
                    : fallbackReason?.includes('403')
                    ? 'Acesso negado — verifique a chave (403)'
                    : fallbackReason?.includes('400')
                    ? 'Requisição inválida (400)'
                    : fallbackReason
                    ? `IA: ${fallbackReason.slice(0, 35)}`
                    : 'Modo offline — IA indisponível'}
                </span>
              </p>
            ) : source === 'ai' ? (
              <p className="text-[10px] text-emerald-500 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Gerado por IA
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
          insights.map((item, i) => (
            <InsightRow key={i} item={item} index={i} isNew={changedIndices.includes(i)} />
          ))
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
