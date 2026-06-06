import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { fetchEnrichedData, clearEnrichedDataCache } from '@/lib/ai/contextBuilder'
import { computeInsights, formatInsightsAsText } from '@/lib/ai/insightsEngine'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export type { InsightItem, InsightsResponse }

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

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
  const apiKey = process.env.GEMINI_API_KEY
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
    if (res.status === 429) throw new Error('QUOTA_429')
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

  // Strip markdown code fences Gemini might add
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

  // ?fresh=true bypasses the 5-min cache (used after realtime events)
  const fresh = req.nextUrl.searchParams.get('fresh') === 'true'
  if (fresh) clearEnrichedDataCache(user.id)

  try {
    // Reuse contextBuilder's shared cache (avoids duplicate DB queries with chat)
    const data = await fetchEnrichedData(user.id)
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
    const msg = String(err instanceof Error ? err.message : err)
    console.error('[insights] erro:', msg)

    const status = msg.includes('QUOTA_429') ? 429 : 500
    return NextResponse.json(
      { error: 'Falha ao gerar insights', details: msg },
      { status }
    )
  }
}
