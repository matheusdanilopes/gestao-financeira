import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { clearEnrichedDataCache } from '@/lib/ai/contextBuilder'
import { computeInsights, formatInsightsAsText } from '@/lib/ai/insightsEngine'
import { createClient } from '@supabase/supabase-js'
import { format, subMonths, startOfMonth } from 'date-fns'
import type { EnrichedData } from '@/lib/ai/types'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export type { InsightItem, InsightsResponse }

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      'placeholder'
  )
}

async function fetchFreshData(): Promise<EnrichedData> {
  const supabase = getSupabase()
  const limite = format(startOfMonth(subMonths(new Date(), 24)), 'yyyy-MM-dd')

  const [r1, r2, r3, r4, r5] = await Promise.all([
    supabase
      .from('transacoes_nubank')
      .select('descricao,valor,responsavel,categoria,projeto_fatura,data,cartao,parcela_atual,total_parcelas')
      .gte('projeto_fatura', limite)
      .order('projeto_fatura', { ascending: false }),
    supabase
      .from('planejamento')
      .select('item,responsavel,valor_previsto,categoria,mes_referencia,parcela_atual,total_parcelas,data_vencimento,data_pagamento')
      .gte('mes_referencia', limite)
      .order('mes_referencia', { ascending: false }),
    supabase.from('configuracoes').select('chave,valor'),
    supabase
      .from('assinaturas')
      .select('nome,valor,cartao,responsavel,categoria,ativa,dia_cobranca')
      .order('valor', { ascending: false }),
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
  ])

  const [invRes, aportesRes] = r5

  return {
    transacoes: (r1.data ?? []) as EnrichedData['transacoes'],
    planejamento: (r2.data ?? []) as EnrichedData['planejamento'],
    configuracoes: (r3.data ?? []) as EnrichedData['configuracoes'],
    assinaturas: (r4.data ?? []) as EnrichedData['assinaturas'],
    investimentos: (invRes.data ?? []) as EnrichedData['investimentos'],
    aportes: (aportesRes.data ?? []) as EnrichedData['aportes'],
    ts: Date.now(),
  }
}

const INSIGHTS_PROMPT = `Você é um analista financeiro pessoal do casal Matheus e Jeniffer.

Analise os dados abaixo e gere exatamente 4 insights para o Dashboard financeiro.

FORMATO DE RESPOSTA (JSON válido, sem markdown extra, sem texto fora do JSON):
[
  {"icone": "<emoji único>", "texto": "<frase curta com valor real em R$>", "nivel": "<alerta|positivo|info|sugestao>"},
  ...
]

REGRAS:
- Exatamente 4 objetos no array
- Cada texto: máximo 110 caracteres, em português, com valor numérico real
- nivel: "alerta" = risco financeiro, "positivo" = ponto bom, "info" = dado neutro, "sugestao" = ação recomendada
- Icones sugeridos: ⚠️ 📊 💡 ✅ 📈 📉 💳 💰 🎯 🔍
- Use APENAS valores dos dados abaixo — nunca invente
- Priorize: variação de gastos, categorias com maior impacto, situação orçamentária, tendência

DADOS FINANCEIROS:
`

async function callGemini(metricsText: string): Promise<InsightItem[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: INSIGHTS_PROMPT + metricsText }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

  // Strip any markdown code fences Gemini might add
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()

  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('Resposta não é um array')

  return parsed.slice(0, 4).map((item: Record<string, string>) => ({
    icone: String(item.icone ?? '📊'),
    texto: String(item.texto ?? '').slice(0, 120),
    nivel: (['alerta', 'positivo', 'info', 'sugestao'].includes(item.nivel)
      ? item.nivel
      : 'info') as InsightItem['nivel'],
  }))
}

export async function GET(req: NextRequest) {
  const { unauthorized, user } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    // Always fetch fresh data so insights reflect latest changes
    clearEnrichedDataCache(user.id)
    const data = await fetchFreshData()
    const metrics = computeInsights(data)
    const metricsText = formatInsightsAsText(metrics)

    const insights = await callGemini(metricsText)
    const response: InsightsResponse = {
      insights,
      updatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[insights] erro:', err)
    return NextResponse.json(
      { error: 'Falha ao gerar insights', details: String(err) },
      { status: 500 }
    )
  }
}
