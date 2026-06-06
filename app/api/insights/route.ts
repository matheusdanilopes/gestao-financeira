import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { fetchEnrichedData, clearEnrichedDataCache } from '@/lib/ai/contextBuilder'
import { computeInsights, serializeInsightsCompact } from '@/lib/ai/insightsEngine'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export type { InsightItem, InsightsResponse }

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// System instruction — set once, not repeated per-message.
// Concise role + task description keeps token cost low.
const SYSTEM_INSTRUCTION = `Você é analista financeiro do casal Matheus (M) e Jeniffer (J).
Com base nos dados JSON, gere exatamente 4 insights acionáveis em português.
Priorize: desvios de gastos, categorias de maior impacto, aderência ao orçamento, tendência histórica.
Cada insight: emoji relevante + frase direta com o valor real em R$ (ex: R$ 1.234,56).`

// Enforced output schema — guarantees valid JSON, eliminates parsing hacks.
const RESPONSE_SCHEMA = {
  type: 'array',
  minItems: 4,
  maxItems: 4,
  items: {
    type: 'object',
    properties: {
      icone:  { type: 'string' },
      texto:  { type: 'string', maxLength: 120 },
      nivel:  { type: 'string', enum: ['alerta', 'positivo', 'info', 'sugestao'] },
    },
    required: ['icone', 'texto', 'nivel'],
  },
}

async function callGemini(compactPayload: string): Promise<InsightItem[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: compactPayload }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 512,
      temperature: 0.3,
    },
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    if (res.status === 429) throw new Error('QUOTA_429')
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

  // responseMimeType guarantees valid JSON — direct parse, no stripping needed
  const parsed: Array<{ icone: string; texto: string; nivel: string }> = JSON.parse(raw)

  return parsed.slice(0, 4).map(item => ({
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

  // ?fresh=true bypasses the 5-min cache (used after realtime events)
  const fresh = req.nextUrl.searchParams.get('fresh') === 'true'
  if (fresh) clearEnrichedDataCache(user.id)

  try {
    const data = await fetchEnrichedData(user.id)
    const metrics = computeInsights(data)
    const payload = serializeInsightsCompact(metrics)

    const insights = await callGemini(payload)
    const response: InsightsResponse = {
      insights,
      updatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err)
    console.error('[insights] erro:', msg)
    return NextResponse.json(
      { error: 'Falha ao gerar insights', details: msg },
      { status: msg.includes('QUOTA_429') ? 429 : 500 }
    )
  }
}
