'use client'

import { Sparkles, RefreshCw, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useInsights } from '@/lib/useInsights'
import type { InsightItem } from '@/lib/insightsTypes'

const NIVEL_STYLES: Record<InsightItem['nivel'], string> = {
  alerta:   'border-l-amber-400 bg-amber-50',
  positivo: 'border-l-emerald-400 bg-emerald-50',
  info:     'border-l-blue-400 bg-blue-50',
  sugestao: 'border-l-violet-400 bg-violet-50',
}

const NIVEL_TEXT: Record<InsightItem['nivel'], string> = {
  alerta:   'text-amber-800',
  positivo: 'text-emerald-800',
  info:     'text-blue-800',
  sugestao: 'text-violet-800',
}

function InsightRow({ item }: { item: InsightItem }) {
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border-l-4 ${NIVEL_STYLES[item.nivel]}`}>
      <span className="text-base leading-none mt-0.5 shrink-0">{item.icone}</span>
      <p className={`text-xs leading-snug font-medium ${NIVEL_TEXT[item.nivel]}`}>
        {item.texto}
      </p>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
  )
}

function formatUpdatedAt(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return 'há menos de 1 minuto'
  if (diffMs < 3_600_000) {
    return formatDistanceToNow(date, { locale: ptBR, addSuffix: true })
  }
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function InsightsCard() {
  const { insights, updatedAt, status, refresh } = useInsights()

  const isLoading = status === 'loading'
  const isUpdating = status === 'updating'
  const isError = status === 'error'
  const hasContent = insights.length > 0

  return (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 leading-none">
              Insights por IA
            </h2>
            {isUpdating && (
              <p className="text-[10px] text-violet-500 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Analisando alterações recentes...
              </p>
            )}
          </div>
        </div>

        {/* Refresh button — only when not loading */}
        {!isLoading && !isUpdating && (
          <button
            onClick={refresh}
            aria-label="Atualizar insights"
            className="p-1.5 rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
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
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-gray-300 shrink-0" />
          <p className="text-[11px] text-gray-400">
            {isUpdating && !updatedAt
              ? 'Calculando insights...'
              : updatedAt
              ? `Atualizado ${formatUpdatedAt(updatedAt)}`
              : 'Atualizando...'}
          </p>
        </div>
      )}
    </div>
  )
}
