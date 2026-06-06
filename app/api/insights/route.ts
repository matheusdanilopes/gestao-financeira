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

Dados financeiros:
${payload}

Gere EXATAMENTE 4 insights em JSON. Responda APENAS com o array JSON, sem texto antes ou depois:
[
  {
    "icone": "<emoji único>",
    "titulo": "<título direto, máx 45 chars>",
    "detalhe": "<métrica com valor real em R$, máx 85 chars>",
    "recomendacao": "<ação concreta e específica, máx 85 chars>",
    "nivel": "<alerta|positivo|info|sugestao>"
  }
]

Regras:
- nivel "alerta": risco financeiro real. "positivo": conquista ou economia. "info": dado neutro. "sugestao": oportunidade de melhora.
- Priorize: desvios de gastos vs histórico, categoria com maior crescimento, aderência ao orçamento, tendência de 3 meses.
- Use valores reais dos dados — nunca invente números.`

async function callGemini(compactPayload: string): Promise<InsightItem[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(compactPayload) }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
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

  // Gemini may prepend prose ("Aqui estão os insights:\n[...]") or wrap in
  // markdown fences. Extract the first complete [...] block regardless of
  // surrounding text to get clean parseable JSON.
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error(`JSON array not found in Gemini response: ${raw.slice(0, 100)}`)
  const parsed: Array<Record<string, string>> = JSON.parse(raw.slice(start, end + 1))

  return parsed.slice(0, 4).map(item => ({
    icone: String(item.icone ?? '📊'),
    titulo: String(item.titulo ?? '').slice(0, 60),
    detalhe: String(item.detalhe ?? item.texto ?? '').slice(0, 100),
    recomendacao: String(item.recomendacao ?? '').slice(0, 100),
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
