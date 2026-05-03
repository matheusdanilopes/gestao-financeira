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

import { useEffect, useState } from 'react'
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

export default function DataStatusIndicator({ status, lastUpdated, onRefresh }: Props) {
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
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
        <WifiOff className="w-3 h-3" />
        Offline
      </span>
    )
  }

  if (status === 'loading' && !lastUpdated) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
        <RefreshCw className="w-3 h-3 animate-spin" />
        Atualizando…
      </span>
    )
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing || !onRefresh}
      className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full hover:bg-gray-100 transition-colors disabled:cursor-default"
      title={onRefresh ? 'Clique para atualizar' : undefined}
    >
      {refreshing ? (
        <RefreshCw className="w-3 h-3 animate-spin text-primary-500" />
      ) : (
        <Wifi className="w-3 h-3 text-green-500" />
      )}
      {label}
    </button>
  )
}
