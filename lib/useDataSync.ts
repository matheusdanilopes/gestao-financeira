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
 * 7. Cache inteligente: só atualiza localStorage quando dados mudam
 * 8. onData só é chamado quando os dados efetivamente mudam
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type SyncStatus = 'fresh' | 'stale' | 'offline' | 'loading'

export interface UseDataSyncReturn {
  status: SyncStatus
  lastUpdated: Date | null
  isOnline: boolean
  refetch: () => Promise<void>
}

export interface UseDataSyncOptions {
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
  /**
   * Callback chamado ao reconectar, antes do fetch.
   * Use para flush de operações offline pendentes.
   */
  onReconnect?: () => Promise<void>
  /** Intervalo de polling em ms quando Realtime falha (padrão: 45 000) */
  pollInterval?: number
  /** Se false, o hook fica inativo (útil p/ condicionar por mês/rota) */
  enabled?: boolean
}

const POLL_INTERVAL_DEFAULT = 45_000
// iOS com WiFi sem internet pode manter fetch travado por minutos (TCP timeout).
// Após esse prazo tratamos como falha de rede e marcamos offline.
const NETWORK_TIMEOUT_MS = 10_000
// Cache stale com mais de 24h é ignorado (força fetch ao reconectar).
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000

export function useDataSync({
  cacheKey,
  tables,
  fetcher,
  onData,
  onReconnect,
  pollInterval = POLL_INTERVAL_DEFAULT,
  enabled = true,
}: UseDataSyncOptions): UseDataSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  const channelRef = useRef<RealtimeChannel | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const isFetchingRef = useRef(false)
  const isOnlineRef = useRef(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  // Geração do fetch: descarta resultados de fetches anteriores quando um novo começa.
  // Evita que fetches "zumbi" (pendentes após timeout) atualizem o estado.
  const fetchGenRef = useRef(0)

  // Usa refs para callbacks e tables — evita que mudanças de referência
  // disparem reconexões desnecessárias do Realtime ou re-adição de listeners.
  const fetcherRef = useRef(fetcher)
  const onDataRef = useRef(onData)
  const onReconnectRef = useRef(onReconnect)
  const tablesRef = useRef(tables)

  useEffect(() => { fetcherRef.current = fetcher })
  useEffect(() => { onDataRef.current = onData })
  useEffect(() => { onReconnectRef.current = onReconnect })
  useEffect(() => { tablesRef.current = tables })

  // ── Cache helpers ──────────────────────────────────────────────
  const readCache = useCallback((): unknown | null => {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(`datasync:${cacheKey}`)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      // Descarta cache com mais de 24h para evitar dados estruturalmente stale
      if (parsed.ts && Date.now() - parsed.ts > CACHE_MAX_AGE_MS) return null
      return parsed.data ?? null
    } catch {
      return null
    }
  }, [cacheKey])

  // Retorna true se os dados foram de fato persistidos (i.e., mudaram)
  const writeCache = useCallback((data: unknown): boolean => {
    if (typeof window === 'undefined' || data === undefined) return false
    try {
      const newStr = JSON.stringify(data)
      const existing = localStorage.getItem(`datasync:${cacheKey}`)
      if (existing) {
        const parsed = JSON.parse(existing)
        if (JSON.stringify(parsed.data) === newStr) return false // dados inalterados
      }
      localStorage.setItem(
        `datasync:${cacheKey}`,
        JSON.stringify({ data, ts: Date.now() })
      )
      return true
    } catch {
      // localStorage cheio ou indisponível — sem crash
      return false
    }
  }, [cacheKey])

  // ── Fetch principal ────────────────────────────────────────────
  // Depende apenas de writeCache (estável por cacheKey) — fetcher e onData
  // são acessados via refs para não causar recriações desnecessárias.
  const doFetch = useCallback(async () => {
    if (!isMountedRef.current || !isOnlineRef.current) return
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    const gen = ++fetchGenRef.current
    try {
      const networkTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('network_timeout')), NETWORK_TIMEOUT_MS)
      )
      const data = await Promise.race([fetcherRef.current(), networkTimeout])
      // Descarta resultado se o componente desmontou OU se um fetch mais recente já começou
      if (!isMountedRef.current || gen !== fetchGenRef.current) return
      if (data !== undefined && data !== null) {
        const changed = writeCache(data)
        // Só repropaga para a UI se os dados mudaram
        if (changed) onDataRef.current?.(data)
      }
      setStatus('fresh')
      setLastUpdated(new Date())
    } catch (err) {
      if (!isMountedRef.current || gen !== fetchGenRef.current) return
      const msg = String(err instanceof Error ? err.message : err).toLowerCase()
      // Falha de rede: timeout local ou "failed to fetch" do fetch API.
      // Ocorre no iOS com WiFi sem internet, onde navigator.onLine = true
      // mas o TCP trava sem retornar erro rapidamente.
      const isNetworkFailure =
        msg.includes('network_timeout') ||
        msg.includes('failed to fetch') ||
        msg.includes('network error') ||
        msg.includes('networkerror')
      if (isNetworkFailure) {
        isOnlineRef.current = false
        setIsOnline(false)
        setStatus('offline')
        // Notifica todos os consumidores de useOnline() para sincronizar o estado global.
        // Resolve a divergência entre useOnline (evento OS) e useDataSync (timeout de rede).
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('offline'))
      } else {
        console.error('[useDataSync] fetch error:', err)
        // Mantém status atual se já havia dados; sinaliza stale caso contrário
        setStatus(prev => prev === 'loading' ? 'stale' : prev)
      }
    } finally {
      isFetchingRef.current = false
    }
  }, [writeCache])

  // ── Realtime ───────────────────────────────────────────────────
  // tablesRef evita que mudanças de referência do array disparem reconexões
  const setupRealtime = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (tablesRef.current.length === 0) return

    const channel = supabase.channel(`datasync:${cacheKey}`)

    tablesRef.current.forEach((table) => {
      channel.on(
        'postgres_changes' as Parameters<typeof channel.on>[0],
        { event: '*', schema: 'public', table },
        () => {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = setTimeout(() => { doFetch() }, 1500)
        }
      )
    })

    channel.subscribe()
    channelRef.current = channel
  }, [cacheKey, doFetch])

  // ── Polling fallback ───────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    pollTimerRef.current = setInterval(() => {
      // Pausa polling quando o app está em background (document.hidden).
      // Evita requests desnecessários que drenam bateria no iOS/Android.
      if (isMountedRef.current && !document.hidden) doFetch()
    }, pollInterval)
  }, [doFetch, pollInterval])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // ── Online / Offline ───────────────────────────────────────────
  // setupRealtime e doFetch são estáveis (cacheKey-scoped) — este efeito
  // só re-roda quando cacheKey muda, não a cada render do pai.
  useEffect(() => {
    async function handleOnline() {
      isOnlineRef.current = true
      setIsOnline(true)
      setStatus('loading')
      if (onReconnectRef.current) await onReconnectRef.current()
      setupRealtime()
      doFetch()
    }
    function handleOffline() {
      isOnlineRef.current = false
      setIsOnline(false)
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
      onDataRef.current?.(cached)
      setStatus('stale')
    }

    // 2. Busca dados frescos (ou sinaliza offline imediatamente)
    if (!isOnlineRef.current) {
      setStatus('offline')
    } else {
      doFetch()
    }

    // 3. Realtime para push de mudanças
    setupRealtime()

    // 4. Polling como fallback
    startPolling()

    return () => {
      isMountedRef.current = false
      stopPolling()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey])

  // ── Refetch manual (background — não exibe skeleton) ──────────
  const refetch = useCallback(async () => {
    await doFetch()
  }, [doFetch])

  return { status, lastUpdated, isOnline, refetch }
}
