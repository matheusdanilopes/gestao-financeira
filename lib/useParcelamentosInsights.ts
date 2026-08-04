'use client'

// useParcelamentosInsights — mesma estratégia de lib/useInsights.ts (stale-while-
// revalidate + Realtime + debounce + cooldown), apontando para o endpoint e cache
// de IA específicos de parcelamentos.

import { useEffect, useRef, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'
import type { InsightsStatus } from '@/lib/useInsights'

export interface ParcelamentosInsightsState {
  insights: InsightItem[]
  updatedAt: Date | null
  status: InsightsStatus
  refreshFailed: boolean
  changedIndices: number[]
  source: 'ai' | 'fallback' | null
  fallbackReason: string | null
  refresh: () => void
}

const CACHE_KEY = 'insights:parcelamentos'
const DEBOUNCE_MS = 5_000
const COOLDOWN_MS = 90_000
const FETCH_TIMEOUT_MS = 55_000
const NEW_BADGE_DURATION_MS = 6_000

const WATCHED_TABLES = ['transacoes_nubank', 'planejamento', 'limites_parcelamentos']

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

export function useParcelamentosInsights(): ParcelamentosInsightsState {
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [status, setStatus] = useState<InsightsStatus>('loading')
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [changedIndices, setChangedIndices] = useState<number[]>([])
  const [source, setSource] = useState<'ai' | 'fallback' | null>(null)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)

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
      const prevTitles = prevInsightsRef.current.map(i => i.titulo)
      const prevParam = prevTitles.length > 0
        ? `prev=${encodeURIComponent(prevTitles.join('||'))}`
        : ''
      const url = fresh
        ? `/api/parcelamentos-insights?fresh=true${prevParam ? `&${prevParam}` : ''}`
        : `/api/parcelamentos-insights${prevParam ? `?${prevParam}` : ''}`
      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!isMountedRef.current) return

      if (!res.ok) {
        setStatus(prev => prev === 'loading' ? 'error' : 'fresh')
        setRefreshFailed(true)
        if (fresh) {
          try { localStorage.removeItem(CACHE_KEY) } catch { /* noop */ }
        }
        return
      }

      const data: InsightsResponse = await res.json()
      writeCache(data)

      const changed = data.insights.reduce<number[]>((acc, item, i) => {
        const prev = prevInsightsRef.current[i]
        if (!prev || prev.titulo !== item.titulo || prev.detalhe !== item.detalhe) acc.push(i)
        return acc
      }, [])

      setInsights(data.insights)
      prevInsightsRef.current = data.insights
      setUpdatedAt(new Date(data.updatedAt))
      setSource(data.source ?? null)
      setFallbackReason(data.fallbackReason ?? null)
      setStatus('fresh')
      setRefreshFailed(false)
      lastFetchRef.current = Date.now()

      if (changed.length > 0 && prevInsightsRef.current.length > 0) {
        setChangedIndices(changed)
        if (newBadgeTimerRef.current) clearTimeout(newBadgeTimerRef.current)
        newBadgeTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setChangedIndices([])
        }, NEW_BADGE_DURATION_MS)
      }
    } catch {
      if (!isMountedRef.current) return
      setStatus(prev => prev === 'loading' ? 'error' : 'fresh')
      if (background) setRefreshFailed(true)
      if (fresh) {
        try { localStorage.removeItem(CACHE_KEY) } catch { /* noop */ }
      }
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
      fetchInsights({ background: true, fresh: false })
    }, DEBOUNCE_MS)
  }, [fetchInsights])

  scheduleRef.current = scheduleDebounced

  const refresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    fetchInsights({ background: insights.length > 0, fresh: true })
  }, [fetchInsights, insights.length])

  useEffect(() => {
    isMountedRef.current = true

    const cached = readCache()
    if (cached) {
      setInsights(cached.insights)
      prevInsightsRef.current = cached.insights
      setUpdatedAt(new Date(cached.updatedAt))
      setSource(cached.source ?? null)
      setFallbackReason(cached.fallbackReason ?? null)
      setStatus('updating')
    }

    fetchInsights({ background: !!cached, fresh: false })

    const channel = supabase.channel('parcelamentos-insights:realtime')
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

  return { insights, updatedAt, status, refreshFailed, changedIndices, source, fallbackReason, refresh }
}
