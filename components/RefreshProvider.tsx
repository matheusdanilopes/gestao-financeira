'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { SyncStatus } from '@/lib/useDataSync'

export interface GlobalSyncState {
  status: SyncStatus
  lastUpdated: Date | null
  isOnline: boolean
  refetch: () => Promise<void>
}

interface RefreshContextValue {
  syncState: GlobalSyncState | null
  register: (state: GlobalSyncState) => void
}

const RefreshContext = createContext<RefreshContextValue>({
  syncState: null,
  register: () => {},
})

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [syncState, setSyncState] = useState<GlobalSyncState | null>(null)
  const register = useCallback((state: GlobalSyncState) => setSyncState(state), [])

  return (
    <RefreshContext.Provider value={{ syncState, register }}>
      {children}
    </RefreshContext.Provider>
  )
}

export function useRefreshContext() {
  return useContext(RefreshContext)
}
