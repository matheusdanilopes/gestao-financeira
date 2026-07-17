// Persisted cache for AI-generated dashboard insights.
// Single shared row: Matheus and Jeniffer see the same financial data, so one
// Gemini result serves both instead of one per device/session/localStorage.

import { createClient } from '@supabase/supabase-js'
import type { InsightItem } from '@/lib/insightsTypes'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      'placeholder'
  )
}

export interface InsightsCacheRow {
  insights: InsightItem[]
  source: 'ai' | 'fallback'
  fallbackReason?: string
  totalGastoSnapshot: number
  updatedAt: string
}

export async function readInsightsCache(): Promise<InsightsCacheRow | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('insights_cache')
    .select('insights,source,fallback_reason,total_gasto_snapshot,updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) return null

  return {
    insights: (data.insights ?? []) as InsightItem[],
    source: (data.source as 'ai' | 'fallback') ?? 'ai',
    fallbackReason: data.fallback_reason ?? undefined,
    totalGastoSnapshot: Number(data.total_gasto_snapshot) || 0,
    updatedAt: data.updated_at,
  }
}

export async function writeInsightsCache(row: {
  insights: InsightItem[]
  source: 'ai' | 'fallback'
  fallbackReason?: string
  totalGastoSnapshot: number
}): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('insights_cache').upsert({
    id: 1,
    insights: row.insights,
    source: row.source,
    fallback_reason: row.fallbackReason ?? null,
    total_gasto_snapshot: row.totalGastoSnapshot,
    updated_at: new Date().toISOString(),
  })
}
