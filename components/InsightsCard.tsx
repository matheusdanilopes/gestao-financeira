'use client'

import { Sparkles, RefreshCw, Clock, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
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
  return (
    <div className={`rounded-2xl overflow-hidden ${c.bg}`}>
      {/* Top bar accent */}
      <div className={`h-0.5 w-full ${c.bar}`} />

      <div className="px-3.5 pt-3 pb-2.5">
        {/* Title row */}
        <div className="flex items-start gap-2.5 mb-1.5">
          <span className="text-[18px] leading-none mt-0.5 shrink-0">{item.icone}</span>
          <p className={`text-sm font-semibold leading-snug ${c.titleColor}`}>
            {item.titulo}
          </p>
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
    <div className="rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800 animate-pulse">
      <div className="h-0.5 w-full bg-gray-200 dark:bg-gray-700" />
      <div className="px-3.5 pt-3 pb-3 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-lg w-3/5" />
        </div>
        <div className="ml-[34px] h-3 bg-gray-200 dark:bg-gray-700 rounded-lg w-4/5" />
        <div className="ml-[34px] h-6 bg-gray-200 dark:bg-gray-700 rounded-xl w-full" />
      </div>
    </div>
  )
}

function formatUpdatedAt(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return 'há menos de 1 minuto'
  return formatDistanceToNow(date, { locale: ptBR, addSuffix: true })
}

export default function InsightsCard() {
  const { insights, updatedAt, status, refresh } = useInsights()

  const isLoading = status === 'loading'
  const isUpdating = status === 'updating'
  const isError = status === 'error'
  const hasContent = insights.length > 0

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-900/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 leading-none">
              Insights por IA
            </h2>
            {isUpdating && (
              <p className="text-[10px] text-violet-500 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Recalculando insights...
              </p>
            )}
          </div>
        </div>

        {!isLoading && !isUpdating && (
          <button
            onClick={refresh}
            aria-label="Atualizar insights"
            className="p-1.5 rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
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
          <div className="flex flex-col items-center gap-2 py-5">
            <p className="text-sm text-gray-400 text-center">
              Não foi possível gerar os insights agora.
            </p>
            <button
              onClick={refresh}
              className="text-xs text-violet-600 font-medium flex items-center gap-1 hover:underline"
            >
              <RefreshCw className="w-3 h-3" /> Tentar novamente
            </button>
          </div>
        ) : hasContent ? (
          insights.map((item, i) => <InsightRow key={i} item={item} />)
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">
            Nenhum dado disponível para análise
          </p>
        )}
      </div>

      {/* Footer */}
      {(updatedAt || isUpdating) && (
        <div className="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" />
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {isUpdating && !updatedAt
              ? 'Analisando movimentações financeiras...'
              : updatedAt
              ? `Atualizado ${formatUpdatedAt(updatedAt)}`
              : 'Atualizando...'}
          </p>
        </div>
      )}
    </div>
  )
}
