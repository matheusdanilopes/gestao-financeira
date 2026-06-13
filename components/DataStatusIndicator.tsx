'use client'

/**
 * DataStatusIndicator — badge de status de sincronização dos dados
 *
 * Exibe:
 *  - "Atualizado agora" / "há Xs" / "há Xmin" após fetch bem-sucedido
 *  - "Atualizando…" enquanto carrega
 *  - "Offline" quando sem conexão
 *  - Botão de refresh manual (opcional)
 */

import { memo, useEffect, useState } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import type { SyncStatus } from '@/lib/useDataSync'

interface Props {
  status: SyncStatus
  lastUpdated: Date | null
  onRefresh?: () => Promise<void>
}

function formatRelativeTime(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 15) return 'agora'
  if (diffSec < 60) return `há ${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `há ${diffMin}min`
  return `há ${Math.floor(diffMin / 60)}h`
}

export default memo(function DataStatusIndicator({ status, lastUpdated, onRefresh }: Props) {
  const [label, setLabel] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    function update() {
      if (status === 'offline') { setLabel('Offline'); return }
      if (status === 'loading') { setLabel('Atualizando…'); return }
      if (!lastUpdated) { setLabel(''); return }
      setLabel(formatRelativeTime(lastUpdated))
    }
    update()
    const timer = setInterval(update, 15_000)
    return () => clearInterval(timer)
  }, [status, lastUpdated])

  async function handleRefresh() {
    if (!onRefresh || refreshing) return
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }

  if (status === 'offline') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                       text-red-600 dark:text-red-400
                       bg-red-50 dark:bg-red-950/40
                       px-2.5 py-1 rounded-full
                       border border-red-100 dark:border-red-800/60
                       shadow-sm">
        <WifiOff className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>Sem conexão</span>
      </span>
    )
  }

  if (status === 'loading' && !lastUpdated) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium
                       text-gray-400 dark:text-gray-500
                       bg-gray-50 dark:bg-gray-800/60
                       px-2.5 py-1 rounded-full">
        <RefreshCw className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
        <span>Atualizando…</span>
      </span>
    )
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing || !onRefresh}
      className="inline-flex items-center gap-1.5 text-[11px] font-medium
                 text-gray-400 dark:text-gray-500
                 bg-gray-50 dark:bg-gray-800/60
                 px-2.5 py-1 rounded-full
                 hover:bg-gray-100 dark:hover:bg-gray-700/60
                 hover:text-gray-600 dark:hover:text-gray-300
                 transition-colors duration-150 disabled:cursor-default
                 group"
      title={onRefresh ? 'Clique para atualizar' : undefined}
      aria-label={onRefresh ? `Dados: ${label}. Clique para atualizar` : `Dados: ${label}`}
    >
      {refreshing ? (
        <RefreshCw className="w-3 h-3 animate-spin text-primary-500 dark:text-primary-400 shrink-0" aria-hidden="true" />
      ) : (
        <Wifi className="w-3 h-3 text-green-500 dark:text-green-400 shrink-0
                         group-hover:text-green-600 dark:group-hover:text-green-300 transition-colors" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  )
})
