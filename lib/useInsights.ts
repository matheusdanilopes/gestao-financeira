'use client'

/**
 * useInsights — Gerenciamento de insights financeiros com IA
 *
 * Estratégia:
 * 1. Carrega insights do localStorage imediatamente (stale-while-revalidate)
 * 2. Busca insights frescos da API em background ao montar
 * 3. Escuta mudanças nas tabelas financeiras via Supabase Realtime
 * 4. Debounce de 5s: múltiplas mudanças em sequência geram apenas uma análise
 * 5. Cooldown de 90s: evita chamadas excessivas à API de IA
 * 6. Marca insights como "atualizando" sem bloquear a exibição do conteúdo atual
 * 7. Timeout de 30s: nunca trava indefinidamente em loading
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
  refresh: () => void
}

const CACHE_KEY = 'insights:dashboard'
const DEBOUNCE_MS = 5_000
const COOLDOWN_MS = 90_000
const FETCH_TIMEOUT_MS = 30_000

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

export function useInsights(): InsightsState {
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [status, setStatus] = useState<InsightsStatus>('loading')
  const [refreshFailed, setRefreshFailed] = useState(false)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const isFetchingRef = useRef(false)
  const lastFetchRef = useRef<number>(0)
  const pendingRefreshRef = useRef(false)
  const scheduleRef = useRef<(() => void) | null>(null)

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
      setInsights(data.insights)
      setUpdatedAt(new Date(data.updatedAt))
      setStatus('fresh')
      setRefreshFailed(false)
      lastFetchRef.current = Date.now()
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
      setUpdatedAt(new Date(cached.updatedAt))
      setStatus('updating')
    }

    // 2. Fetch fresh insights on mount
    fetchInsights({ background: !!cached, fresh: false })

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
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fetchInsights, scheduleDebounced])

  return { insights, updatedAt, status, refreshFailed, refresh }
}
