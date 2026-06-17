import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { fetchEnrichedData, clearEnrichedDataCache } from '@/lib/ai/contextBuilder'
import { computeInsights, serializeInsightsCompact, generateFallbackInsights } from '@/lib/ai/insightsEngine'
import { validateFinancialData } from '@/lib/ai/financialValidationEngine'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export type { InsightItem, InsightsResponse }

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// Single user message that combines role + data + output instruction.
// Mirrors the pattern used by the chat route (no systemInstruction, no responseSchema)
// to stay compatible with all gemini-3-flash-preview versions.
const CATEGORIA_ACTION: Record<string, { label: string; route: string }> = {
  gastos:        { label: 'Ver compras',       route: '/compras' },
  orcamento:     { label: 'Ver planejamento',  route: '/financas?tab=despesas' },
  investimentos: { label: 'Ver investimentos', route: '/investimentos' },
  assinaturas:   { label: 'Ver assinaturas',   route: '/assinaturas' },
  poupanca:      { label: 'Ver finanças',      route: '/financas' },
}

const buildPrompt = (payload: string, confiabilidade: number, prevTitles: string[]) =>
  `Você é analista financeiro do casal Matheus (M) e Jeniffer (J).
${prevTitles.length > 0 ? `
ANTI-REPETIÇÃO OBRIGATÓRIA: A análise anterior já continha estes títulos:
${prevTitles.map((t, i) => `  ${i + 1}. "${t}"`).join('\n')}
Você DEVE gerar insights com ângulos COMPLETAMENTE diferentes — não repita o mesmo título, a mesma métrica nem a mesma recomendação. Explore dimensões que não foram cobertas anteriormente.
` : ''}
Dados financeiros auditados (confiabilidade: ${confiabilidade}% | campo "dia" = dia atual do mês):
${payload}

Gere EXATAMENTE 4 insights em JSON. Responda APENAS com o array JSON, sem texto antes ou depois:
[
  {
    "icone": "<emoji único>",
    "titulo": "<título direto, máx 45 chars>",
    "detalhe": "<métrica com valor real em R$, máx 85 chars>",
    "recomendacao": "<ação concreta e específica, máx 85 chars>",
    "nivel": "<alerta|positivo|info|sugestao>",
    "categoria": "<gastos|orcamento|investimentos|assinaturas|poupanca>"
  }
]

Glossário dos campos:
- "gasto": faturas de cartão de crédito — exatamente o que a tela "Compras" exibe
- "mediaCartao": média histórica de 6 meses de compras no cartão (compare "gasto" contra este)
- "totalMes": total do mês = faturas cartão + despesas fixas (visão holística de gastos)
- "media6m": média histórica combinada (cartão + fixas) — compare "totalMes" contra este
- "orc[0]": total das despesas fixas planejadas | "orc[1]": já pago | "orc[2]": em aberto
- "renda": renda mensal configurada | "sobra": renda - totalMes | "poupPct": % da renda poupada
- "assinsCats": top categorias de assinaturas [[categoria, R$], ...]

Regras:
- CRÍTICO: insights com categoria "gastos" devem referenciar "gasto" (cartão) e comparar contra "mediaCartao" — NUNCA use "totalMes" para insights de categoria "gastos", pois o valor não baterá com a tela "Compras" que o usuário vai ver ao clicar.
- Para visão holística (sobra, taxa de poupança), use "totalMes" e "renda".
- Ao falar de "total de despesas do mês" sem contexto específico, use "totalMes".
- nivel "alerta": risco financeiro real. "positivo": conquista ou economia. "info": dado neutro. "sugestao": oportunidade de melhora.
- "categoria": classifique — "gastos" (compras/transações), "orcamento" (planejamento/vencimentos), "investimentos" (aportes/carteira), "assinaturas" (serviços recorrentes), "poupanca" (sobra/taxa de poupança).
- Priorize: desvios de gastos vs histórico, categoria com maior crescimento, aderência ao orçamento, tendência de 3 meses.
- Se "vencidos" não vazio: priorize alerta de despesas em atraso com os itens específicos.
- Se "venc7d" não vazio: destaque vencimentos nos próximos 7 dias.
- Se "dia" < 15 e % pago do orçamento for baixo (orc[1]/orc[0]): não trate como alerta — é início do mês.
- Se "renda" e "sobra" presentes: inclua 1 insight sobre taxa de poupança ("poupPct"), usando categoria "poupanca".
- Equilíbrio obrigatório: máximo 2 insights com nivel "alerta" — inclua sempre ≥1 "positivo" ou "info", salvo situação financeira criticamente negativa (sobra < 0 e vencidos > 0 simultaneamente).
- Use valores reais dos dados — nunca invente números.`

async function callGemini(compactPayload: string, confiabilidade: number, prevTitles: string[]): Promise<InsightItem[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(compactPayload, confiabilidade, prevTitles) }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.5 },
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
  // markdown fences. Extract the first complete [...] block via bracket depth
  // so trailing bracketed content (citations, footnotes) is not included.
  const start = raw.indexOf('[')
  if (start === -1) throw new Error(`JSON array not found in Gemini response: ${raw.slice(0, 100)}`)
  let depth = 0
  let end = -1
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '[') depth++
    else if (raw[i] === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error(`Unclosed JSON array in Gemini response: ${raw.slice(0, 100)}`)
  const parsed: Array<Record<string, string>> = JSON.parse(raw.slice(start, end + 1))

  return parsed.slice(0, 4).map(item => {
    const action = CATEGORIA_ACTION[String(item.categoria ?? '')]
    return {
      icone: String(item.icone ?? '📊'),
      titulo: String(item.titulo ?? '').slice(0, 60),
      detalhe: String(item.detalhe ?? item.texto ?? '').slice(0, 100),
      recomendacao: String(item.recomendacao ?? '').slice(0, 100),
      nivel: (['alerta', 'positivo', 'info', 'sugestao'].includes(item.nivel)
        ? item.nivel
        : 'info') as InsightItem['nivel'],
      ...(action ? { action } : {}),
    }
  })
}

export async function GET(req: NextRequest) {
  const { unauthorized, user } = await requireAuth(req)
  if (unauthorized) return unauthorized

  // ?fresh=true bypasses the 5-min cache (used after realtime events)
  const fresh = req.nextUrl.searchParams.get('fresh') === 'true'
  if (fresh) clearEnrichedDataCache(user.id)

  // ?prev=title1||title2||... — titles from the previous render, used to avoid repetition
  const prevRaw = req.nextUrl.searchParams.get('prev') ?? ''
  const prevTitles = prevRaw ? prevRaw.split('||').filter(Boolean).slice(0, 4) : []

  try {
    const rawData = await fetchEnrichedData(user.id)

    // Mandatory validation gate (RN11): validate before computing any metric
    const { validatedData, certificate } = validateFinancialData(rawData)
    console.log(`[insights] validação: ${certificate.indiceConfiabilidade}% | ${certificate.transacoesValidadas}/${certificate.totalTransacoes} tx | ${certificate.transacoesExcluidas} excluídas`)

    const metrics = computeInsights(validatedData)

    // Try Gemini first; fall back to rule-based insights on any failure
    let insights: InsightItem[]
    let source: 'ai' | 'fallback' = 'ai'
    let fallbackReason: string | undefined
    try {
      const payload = serializeInsightsCompact(metrics)
      insights = await callGemini(payload, certificate.indiceConfiabilidade, prevTitles)
    } catch (geminiErr) {
      const reason = String(geminiErr instanceof Error ? geminiErr.message : geminiErr)
      console.error('[insights] Gemini falhou, usando fallback:', reason)
      insights = generateFallbackInsights(metrics)
      source = 'fallback'
      fallbackReason = reason
    }

    console.log(`[insights] gerado via ${source}: ${insights.length} itens`)

    const response: InsightsResponse = {
      insights,
      updatedAt: new Date().toISOString(),
      source,
      ...(fallbackReason ? { fallbackReason } : {}),
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
