import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { fetchEnrichedData, clearEnrichedDataCache } from '@/lib/ai/contextBuilder'
import { computeInsights, serializeInsightsCompact, generateFallbackInsights } from '@/lib/ai/insightsEngine'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export type { InsightItem, InsightsResponse }

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// Single user message that combines role + data + output instruction.
// Mirrors the pattern used by the chat route (no systemInstruction, no responseSchema)
// to stay compatible with all gemini-3-flash-preview versions.
const buildPrompt = (payload: string) =>
  `Você é analista financeiro do casal Matheus (M) e Jeniffer (J).

Dados financeiros (JSON compacto):
${payload}

Gere EXATAMENTE 4 insights em JSON. Responda APENAS com o array, sem texto extra:
[{"icone":"<emoji>","texto":"<frase em pt-BR com valor em R$, máx 110 chars>","nivel":"<alerta|positivo|info|sugestao>"},...]

Priorize: variação de gastos, maiores categorias, aderência ao orçamento, tendência.`

async function callGemini(compactPayload: string): Promise<InsightItem[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(compactPayload) }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.3 },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[insights] Gemini ${res.status}:`, text.slice(0, 500))
    if (res.status === 429) throw new Error('QUOTA_429')
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

  // Strip markdown fences if present, then parse
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
  const parsed: Array<{ icone: string; texto: string; nivel: string }> = JSON.parse(cleaned)

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

    // Try Gemini first; fall back to rule-based insights on any failure
    let insights: InsightItem[]
    let source: 'ai' | 'fallback' = 'ai'
    try {
      const payload = serializeInsightsCompact(metrics)
      insights = await callGemini(payload)
    } catch (geminiErr) {
      console.error('[insights] Gemini falhou, usando fallback:', String(geminiErr))
      insights = generateFallbackInsights(metrics)
      source = 'fallback'
    }

    console.log(`[insights] gerado via ${source}: ${insights.length} itens`)

    const response: InsightsResponse = {
      insights,
      updatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err)
    console.error('[insights] erro fatal (dados):', msg)
    return NextResponse.json(
      { error: 'Falha ao gerar insights', details: msg },
      { status: 500 }
    )
  }
}
