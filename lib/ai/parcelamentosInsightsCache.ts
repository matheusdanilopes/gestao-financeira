// Cache persistido para os insights de IA da tela de Parcelamentos.
// Linha única (Matheus e Jeniffer veem os mesmos dados, então um resultado do
// Gemini serve para os dois) — mesmo padrão de lib/ai/insightsCache.ts, tabela
// própria (parcelamentos_insights_cache) porque o domínio é diferente.

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

export interface ParcelamentosInsightsCacheRow {
  insights: InsightItem[]
  source: 'ai' | 'fallback'
  fallbackReason?: string
  comprometidoSnapshot: number
  updatedAt: string
}

export async function readParcelamentosInsightsCache(): Promise<ParcelamentosInsightsCacheRow | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('parcelamentos_insights_cache')
    .select('insights,source,fallback_reason,comprometido_snapshot,updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) return null

  return {
    insights: (data.insights ?? []) as InsightItem[],
    source: (data.source as 'ai' | 'fallback') ?? 'ai',
    fallbackReason: data.fallback_reason ?? undefined,
    comprometidoSnapshot: Number(data.comprometido_snapshot) || 0,
    updatedAt: data.updated_at,
  }
}

export async function writeParcelamentosInsightsCache(row: {
  insights: InsightItem[]
  source: 'ai' | 'fallback'
  fallbackReason?: string
  comprometidoSnapshot: number
}): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('parcelamentos_insights_cache').upsert({
    id: 1,
    insights: row.insights,
    source: row.source,
    fallback_reason: row.fallbackReason ?? null,
    comprometido_snapshot: row.comprometidoSnapshot,
    updated_at: new Date().toISOString(),
  })
}
