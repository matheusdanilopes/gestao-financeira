// Central AI Context Builder — assembles structured context for every AI request

import { format, subMonths, startOfMonth } from 'date-fns'
import { createClient } from '@supabase/supabase-js'
import type { EnrichedData } from './types'

// ─── Per-user cache ───────────────────────────────────────────────────────────
// Keyed by userId to prevent data leakage between users.
// Serverless functions are ephemeral — this cache lives for the lifetime of a
// single function instance and is never shared across users or requests from
// different users in the same instance, because userId is always the key.

const _userCache = new Map<string, { data: EnrichedData; ts: number }>()
// Kept short on purpose: the AI must reflect changes made moments ago (new
// expense, payment, import) without serving a stale snapshot for minutes.
// buildChatContext() also forces a bypass on the first message of every
// conversation, so this TTL only bounds staleness within a single chat.
const CACHE_TTL_MS = 60 * 1000
const MAX_CACHE_ENTRIES = 10 // prevent unbounded memory growth

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      'placeholder'
  )
}

export function clearEnrichedDataCache(userId: string): void {
  _userCache.delete(userId)
}

export async function fetchEnrichedData(userId: string, force = false): Promise<EnrichedData> {
  const now = Date.now()
  const cached = _userCache.get(userId)
  if (!force && cached && now - cached.ts < CACHE_TTL_MS) return cached.data

  // Evict oldest entry if cache is full, to prevent unbounded growth
  if (_userCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [..._userCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) _userCache.delete(oldest[0])
  }

  const supabase = getSupabase()
  const limite = format(startOfMonth(subMonths(new Date(), 24)), 'yyyy-MM-dd')

  // Estornos only need a short recent window — they're used to explain
  // why a bill differs from the raw sum of purchases, not for long-term history.
  const limiteEstornos = format(startOfMonth(subMonths(new Date(), 3)), 'yyyy-MM-dd')

  const [r1, r2, r3, r4, r5, r6] = await Promise.all([
    // Transactions (last 24 months) — exclude reversed purchases and reversal entries
    supabase
      .from('transacoes_nubank')
      .select('descricao,valor,responsavel,categoria,projeto_fatura,data,cartao,parcela_atual,total_parcelas')
      .gte('projeto_fatura', limite)
      .neq('status', 'ESTORNO')
      .neq('status', 'ESTORNADO')
      .order('projeto_fatura', { ascending: false }),

    // Planning/budgets (includes [RECEITA]* rows — filtered by convention downstream)
    supabase
      .from('planejamento')
      .select('item,responsavel,valor_previsto,categoria,mes_referencia,parcela_atual,total_parcelas,data_vencimento,data_pagamento,valor_real,pago')
      .gte('mes_referencia', limite)
      .order('mes_referencia', { ascending: false }),

    // Settings
    supabase.from('configuracoes').select('chave,valor'),

    // Subscriptions
    supabase
      .from('assinaturas')
      .select('nome,valor,cartao,responsavel,categoria,ativa,dia_cobranca')
      .order('valor', { ascending: false }),

    // Investments + contributions
    Promise.all([
      supabase
        .from('investimentos')
        .select('id,descricao,percentual,mes_referencia')
        .order('mes_referencia', { ascending: false }),
      supabase
        .from('investimentos_aportes')
        .select('investimento_id,valor,data_aporte,observacao')
        .order('data_aporte', { ascending: false })
        .limit(100),
    ]),

    // Estornos (reversals) — kept visible so the AI can explain adjustments
    // instead of silently working with a net figure it can't account for.
    supabase
      .from('transacoes_nubank')
      .select('descricao,valor,data,cartao,projeto_fatura,status')
      .gte('projeto_fatura', limiteEstornos)
      .in('status', ['ESTORNO', 'ESTORNADO'])
      .order('data', { ascending: false })
      .limit(50),
  ])

  const [invRes, aportesRes] = r5

  const data: EnrichedData = {
    transacoes: (r1.data ?? []) as EnrichedData['transacoes'],
    planejamento: (r2.data ?? []) as EnrichedData['planejamento'],
    configuracoes: (r3.data ?? []) as EnrichedData['configuracoes'],
    assinaturas: (r4.data ?? []) as EnrichedData['assinaturas'],
    investimentos: (invRes.data ?? []) as EnrichedData['investimentos'],
    aportes: (aportesRes.data ?? []) as EnrichedData['aportes'],
    estornos: (r6.data ?? []) as EnrichedData['estornos'],
    ts: now,
  }

  _userCache.set(userId, { data, ts: now })
  return data
}
