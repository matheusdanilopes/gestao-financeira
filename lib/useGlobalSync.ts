'use client'

import { useEffect } from 'react'
import { useDataSync, type UseDataSyncOptions } from './useDataSync'
import { useRefreshContext } from '@/components/RefreshProvider'

/**
 * useGlobalSync — wrapper de useDataSync que também registra o estado de
 * sincronização no contexto global (RefreshProvider), permitindo que o
 * ClientShell exiba o indicador de status ao lado do sino de notificações.
 */
export function useGlobalSync(options: UseDataSyncOptions) {
  const { register } = useRefreshContext()
  const sync = useDataSync(options)

  useEffect(() => {
    register({
      status: sync.status,
      lastUpdated: sync.lastUpdated,
      isOnline: sync.isOnline,
      refetch: sync.refetch,
    })
  // refetch é estável (useCallback), register é estável (useCallback no provider)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.status, sync.lastUpdated, sync.isOnline, register])

  return sync
}
