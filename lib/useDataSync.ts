'use client'

/**
 * useDataSync — Sincronização automática de dados do Supabase
 *
 * Estratégia:
 * 1. Carrega cache do localStorage imediatamente (stale-while-revalidate)
 * 2. Busca dados frescos do Supabase em background sem bloquear a UI
 * 3. Escuta mudanças via Supabase Realtime (postgres_changes)
 * 4. Fallback: polling a cada 45s caso o Realtime esteja indisponível
 * 5. Detecta perda/retorno de conexão e sincroniza ao reconectar
 * 6. Revalida automaticamente ao app voltar ao foco (visibilitychange)
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type SyncStatus = 'fresh' | 'stale' | 'offline' | 'loading'

export interface UseDataSyncReturn {
  status: SyncStatus
  lastUpdated: Date | null
  refetch: () => Promise<void>
}

interface UseDataSyncOptions {
  /** Chave única para o cache no localStorage */
  cacheKey: string
  /** Tabelas do Supabase para escutar via Realtime */
  tables: string[]
  /**
   * Função que busca os dados e retorna qualquer valor serializável.
   * Pode retornar void — nesse caso o cache não é atualizado, mas
   * onData ainda é chamado se fornecido.
   */
  fetcher: () => Promise<unknown>
  /**
   * Callback opcional chamado com os dados vindos do fetcher ou do cache.
   * Use quando quiser receber os dados fora do fetcher.
   */
  onData?: (data: unknown) => void
  /** Intervalo de polling em ms quando Realtime falha (padrão: 45 000) */
  pollInterval?: number
  /** Se false, o hook fica inativo (útil p/ condicionar por mês/rota) */
  enabled?: boolean
}

const POLL_INTERVAL_DEFAULT = 45_000

export function useDataSync({
  cacheKey,
  tables,
  fetcher,
  onData,
  pollInterval = POLL_INTERVAL_DEFAULT,
  enabled = true,
}: UseDataSyncOptions): UseDataSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)
  const isOnlineRef = useRef(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  // ── Cache helpers ──────────────────────────────────────────────
  const readCache = useCallback((): unknown | null => {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(`datasync:${cacheKey}`)
      if (!raw) return null
      return JSON.parse(raw).data ?? null
    } catch {
      return null
    }
  }, [cacheKey])

  const writeCache = useCallback((data: unknown) => {
    if (typeof window === 'undefined' || data === undefined) return
    try {
      localStorage.setItem(
        `datasync:${cacheKey}`,
        JSON.stringify({ data, ts: Date.now() })
      )
    } catch {
      // localStorage cheio ou indisponível — sem crash
    }
  }, [cacheKey])

  // ── Fetch principal ────────────────────────────────────────────
  const doFetch = useCallback(async () => {
    if (!isMountedRef.current || !isOnlineRef.current) return
    try {
      const data = await fetcher()
      if (!isMountedRef.current) return
      // Persiste no cache apenas se o fetcher retornar algo
      if (data !== undefined && data !== null) {
        writeCache(data)
        onData?.(data)
      }
      setStatus('fresh')
      setLastUpdated(new Date())
    } catch (err) {
      console.error('[useDataSync] fetch error:', err)
      // Mantém status atual se já havia dados; sinaliza stale caso contrário
      setStatus(prev => prev === 'loading' ? 'stale' : prev)
    }
  }, [fetcher, onData, writeCache])

  // ── Realtime ───────────────────────────────────────────────────
  const setupRealtime = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (tables.length === 0) return

    const channel = supabase.channel(`datasync:${cacheKey}`)

    tables.forEach((table) => {
      channel.on(
        'postgres_changes' as Parameters<typeof channel.on>[0],
        { event: '*', schema: 'public', table },
        () => { doFetch() }
      )
    })

    channel.subscribe()
    channelRef.current = channel
  }, [cacheKey, tables, doFetch])

  // ── Polling fallback ───────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    pollTimerRef.current = setInterval(() => {
      if (isMountedRef.current) doFetch()
    }, pollInterval)
  }, [doFetch, pollInterval])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // ── Online / Offline ───────────────────────────────────────────
  useEffect(() => {
    function handleOnline() {
      isOnlineRef.current = true
      setStatus('loading')
      setupRealtime()
      doFetch()
    }
    function handleOffline() {
      isOnlineRef.current = false
      setStatus('offline')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setupRealtime, doFetch])

  // ── Revalida ao voltar ao foco ─────────────────────────────────
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && isOnlineRef.current) {
        doFetch()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [doFetch])

  // ── Inicialização principal ────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    isMountedRef.current = true

    // 1. Serve cache imediatamente (stale-while-revalidate)
    const cached = readCache()
    if (cached !== null) {
      onData?.(cached)
      setStatus('stale')
    }

    // 2. Busca dados frescos em background
    doFetch()

    // 3. Realtime para push de mudanças
    setupRealtime()

    // 4. Polling como fallback
    startPolling()

    return () => {
      isMountedRef.current = false
      stopPolling()
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey])

  // ── Refetch manual ─────────────────────────────────────────────
  const refetch = useCallback(async () => {
    setStatus('loading')
    await doFetch()
  }, [doFetch])

  return { status, lastUpdated, refetch }
}
