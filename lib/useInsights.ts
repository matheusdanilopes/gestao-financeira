'use client'

/**
 * useInsights — Gerenciamento de insights financeiros com IA
 *
 * Estratégia:
 * 1. Carrega insights do localStorage imediatamente (stale-while-revalidate)
 * 2. Busca insights frescos da API em background ao montar
 * 3. Se o cache tiver mais de 12h, força ?fresh=true para nova análise via IA
 * 4. Escuta mudanças nas tabelas financeiras via Supabase Realtime
 * 5. Debounce de 5s: múltiplas mudanças em sequência geram apenas uma análise
 * 6. Cooldown de 90s: evita chamadas excessivas à API de IA
 * 7. Marca insights como "atualizando" sem bloquear a exibição do conteúdo atual
 * 8. Timeout de 30s: nunca trava indefinidamente em loading
 * 9. Detecta mudança real de conteúdo e sinaliza com changedIndices por 6s
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export type InsightsStatus = 'idle' | 'loading' | 'updating' | 'fresh' | 'error'

export interface InsightsState {
  insights: InsightItem[]
  updatedAt: Date | null
  status: InsightsStatus
  refreshFailed: boolean
  changedIndices: number[]
  refresh: () => void
}

const CACHE_KEY = 'insights:dashboard'
const DEBOUNCE_MS = 5_000
const COOLDOWN_MS = 90_000
const FETCH_TIMEOUT_MS = 30_000
const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000  // 12 horas
const NEW_BADGE_DURATION_MS = 6_000

// Tables that trigger insight re-analysis when changed
const WATCHED_TABLES = [
  'transacoes_nubank',
  'planejamento',
  'investimentos',
  'investimentos_aportes',
  'assinaturas',
  'faturas',
]

function readCache(): InsightsResponse | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as InsightsResponse
  } catch {
    return null
  }
}

function writeCache(data: InsightsResponse): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch { /* localStorage cheio — sem crash */ }
}

function isCacheFresh(data: InsightsResponse): boolean {
  try {
    return Date.now() - new Date(data.updatedAt).getTime() < MAX_CACHE_AGE_MS
  } catch { return false }
}

export function useInsights(): InsightsState {
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [status, setStatus] = useState<InsightsStatus>('loading')
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [changedIndices, setChangedIndices] = useState<number[]>([])

  const channelRef = useRef<RealtimeChannel | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const newBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const isFetchingRef = useRef(false)
  const lastFetchRef = useRef<number>(0)
  const pendingRefreshRef = useRef(false)
  const scheduleRef = useRef<(() => void) | null>(null)
  const prevInsightsRef = useRef<InsightItem[]>([])

  const fetchInsights = useCallback(async (opts: { background?: boolean; fresh?: boolean } = {}) => {
    const { background = false, fresh = false } = opts
    if (!isMountedRef.current) return

    const now = Date.now()
    if (isFetchingRef.current) {
      pendingRefreshRef.current = true
      return
    }
    // Within cooldown on background-only fetches
    if (background && !fresh && now - lastFetchRef.current < COOLDOWN_MS) return

    isFetchingRef.current = true
    if (!background) {
      setStatus('loading')
    } else {
      setStatus(prev => (prev === 'fresh' || prev === 'updating') ? 'updating' : prev)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const url = fresh ? '/api/insights?fresh=true' : '/api/insights'
      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!isMountedRef.current) return

      if (!res.ok) {
        setStatus(prev => prev === 'loading' ? 'error' : 'fresh')
        setRefreshFailed(true)
        return
      }

      const data: InsightsResponse = await res.json()
      writeCache(data)

      // Detect which insights actually changed content vs previous render
      const changed = data.insights.reduce<number[]>((acc, item, i) => {
        const prev = prevInsightsRef.current[i]
        if (!prev || prev.titulo !== item.titulo || prev.detalhe !== item.detalhe) acc.push(i)
        return acc
      }, [])

      setInsights(data.insights)
      prevInsightsRef.current = data.insights
      setUpdatedAt(new Date(data.updatedAt))
      setStatus('fresh')
      setRefreshFailed(false)
      lastFetchRef.current = Date.now()

      // Signal changed cards — auto-clear badge after 6s
      if (changed.length > 0 && prevInsightsRef.current.length > 0) {
        setChangedIndices(changed)
        if (newBadgeTimerRef.current) clearTimeout(newBadgeTimerRef.current)
        newBadgeTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setChangedIndices([])
        }, NEW_BADGE_DURATION_MS)
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setStatus(prev => prev === 'loading' ? 'error' : 'fresh')
      if (background) setRefreshFailed(true)
    } finally {
      clearTimeout(timeoutId)
      isFetchingRef.current = false
      if (pendingRefreshRef.current && isMountedRef.current) {
        pendingRefreshRef.current = false
        scheduleRef.current?.()
      }
    }
  }, [])

  const scheduleDebounced = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      fetchInsights({ background: true, fresh: true })
    }, DEBOUNCE_MS)
  }, [fetchInsights])

  scheduleRef.current = scheduleDebounced

  const refresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    fetchInsights({ background: insights.length > 0, fresh: true })
  }, [fetchInsights, insights.length])

  useEffect(() => {
    isMountedRef.current = true

    // 1. Serve stale cache immediately
    const cached = readCache()
    if (cached) {
      setInsights(cached.insights)
      prevInsightsRef.current = cached.insights
      setUpdatedAt(new Date(cached.updatedAt))
      setStatus('updating')
    }

    // 2. Fetch fresh insights on mount.
    //    Force ?fresh=true when cache is older than 12h so the AI re-analyses.
    const stale = !cached || !isCacheFresh(cached)
    fetchInsights({ background: !!cached, fresh: stale })

    // 3. Realtime subscriptions on all financial tables
    const channel = supabase.channel('insights:realtime')
    WATCHED_TABLES.forEach(table => {
      channel.on(
        'postgres_changes' as Parameters<typeof channel.on>[0],
        { event: '*', schema: 'public', table },
        () => { scheduleDebounced() }
      )
    })
    channel.subscribe()
    channelRef.current = channel

    return () => {
      isMountedRef.current = false
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (newBadgeTimerRef.current) clearTimeout(newBadgeTimerRef.current)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fetchInsights, scheduleDebounced])

  return { insights, updatedAt, status, refreshFailed, changedIndices, refresh }
}
