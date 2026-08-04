import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { computeParcelamentosMetrics, serializeParcelamentosCompact, generateFallbackParcelamentosInsights } from '@/lib/ai/parcelamentosInsightsEngine'
import { readParcelamentosInsightsCache, writeParcelamentosInsightsCache } from '@/lib/ai/parcelamentosInsightsCache'
import type { InsightItem, InsightsResponse } from '@/lib/insightsTypes'

export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// Domínio mais estreito que o dashboard (só parcelamentos) → recálculo mais
// sensível a mudanças: comprometido total mudar >R$150 desde o último cálculo,
// ou cache com mais de 24h.
const RECALC_THRESHOLD_REAIS = 150
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000

const buildPrompt = (payload: string, prevTitles: string[]) =>
  `Você é um consultor especializado em gestão de parcelamentos de cartão de crédito do casal Matheus (M) e Jeniffer (J).
${prevTitles.length > 0 ? `
ANTI-REPETIÇÃO OBRIGATÓRIA: A análise anterior já continha estes títulos:
${prevTitles.map((t, i) => `  ${i + 1}. "${t}"`).join('\n')}
Gere insights com ângulos COMPLETAMENTE diferentes.
` : ''}
Dados de parcelamentos (JSON compacto):
${payload}

Gere ENTRE 2 e 4 insights em JSON. Responda APENAS com o array JSON, sem texto antes ou depois:
[
  {
    "icone": "<emoji único>",
    "titulo": "<título direto, máx 45 chars>",
    "detalhe": "<métrica com valor real em R$, máx 85 chars>",
    "recomendacao": "<ação concreta e específica, máx 85 chars>",
    "nivel": "<alerta|positivo|info|sugestao>"
  }
]

Glossário dos campos:
- "mes": mês da fatura em análise (mês em que as parcelas do momento aparecem cobradas)
- "comprometido": total já comprometido em parcelas neste mês — M/J/C (Matheus/Jeniffer/Conjunto) e total
- "limite": limite mensal de parcelamentos configurado por pessoa (ausente = sem limite definido)
- "pct": % do limite já comprometido, por pessoa (ausente = sem limite configurado)
- "concentracao": qual dos dois (M ou J) concentra mais do comprometido do casal, e o %
- "tendenciaPct": variação do comprometido total vs a média dos últimos 6 meses
- "mediaHistorica6m": média mensal comprometida nos últimos 6 meses
- "novasParcelasMes": quantas compras parceladas NOVAS (1ª parcela) começaram neste mês
- "topCategorias": categorias que mais pesam no comprometido do mês — [nome, R$, % do total]
- "livreEm": mês em que cada pessoa fica livre de parcelamentos (sem nenhuma parcela em aberto), considerando só o que já foi comprometido — null se não houver dado
- "mesesComRisco": meses futuros (próximos 6) em que o comprometido projetado já ultrapassa o limite configurado daquela pessoa — [mês, responsável, R$ comprometido, R$ limite]

Regras:
- CRÍTICO: parcelamentos no Brasil normalmente NÃO têm juros (parcela = valor total / nº de parcelas) — NUNCA mencione juros, taxa de juros ou economia de juros.
- Foque em REDUÇÃO (evitar comprometer meses futuros além do necessário), CONTROLE (limite, concentração de risco entre as duas pessoas) e ORIENTAÇÃO (o que fazer a seguir).
- Se "mesesComRisco" não vazio: priorize um alerta sobre o mês/pessoa mais próximo que estoura o limite — isso é sempre a prioridade máxima.
- Se "concentracao" mostrar >65% em uma pessoa: sugira equilibrar novas compras parceladas com a outra.
- Se "pct" de alguém estiver perto de 100 (mas "mesesComRisco" vazio): avise sobre o limite do mês atual.
- Se nada disso se aplicar: use "tendenciaPct", "topCategorias" ou "livreEm" para dar uma leitura de controle/orientação.
- Use valores reais dos dados — nunca invente números.
- Responda em português brasileiro, valores como R$ X.XXX,XX.`

async function callGemini(payload: string, prevTitles: string[]): Promise<InsightItem[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: buildPrompt(payload, prevTitles) }] }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.5, responseMimeType: 'application/json' },
  })

  const MAX_RETRIES = 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt * 800))
    }

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (res.ok) {
      const data = await res.json()
      const finishReason: string = data.candidates?.[0]?.finishReason ?? 'UNKNOWN'
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      console.log(`[parcelamentos-insights] Gemini ok (finishReason=${finishReason}, chars=${raw.length}):`, raw.slice(0, 400))

      if (!raw) throw new Error('Gemini retornou resposta vazia')

      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

      const start = cleaned.indexOf('[')
      if (start === -1) throw new Error(`JSON array not found: ${raw.slice(0, 100)}`)

      let depth = 0, end = -1, inString = false, escaped = false
      for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\' && inString) { escaped = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === '[') depth++
        else if (ch === ']') { depth--; if (depth === 0) { end = i; break } }
      }

      if (end === -1) {
        const lastClose = cleaned.lastIndexOf(']')
        if (lastClose > start) {
          end = lastClose
          console.warn('[parcelamentos-insights] bracket counter failed, using lastIndexOf fallback')
        } else {
          throw new Error(`Unclosed JSON array (finishReason=${finishReason}): ${raw.slice(0, 150)}`)
        }
      }

      const parsed: Array<Record<string, string>> = JSON.parse(cleaned.slice(start, end + 1))

      return parsed.slice(0, 4).map(item => ({
        icone: String(item.icone ?? '📊'),
        titulo: String(item.titulo ?? '').slice(0, 60),
        detalhe: String(item.detalhe ?? '').slice(0, 100),
        recomendacao: String(item.recomendacao ?? '').slice(0, 100),
        nivel: (['alerta', 'positivo', 'info', 'sugestao'].includes(item.nivel)
          ? item.nivel
          : 'info') as InsightItem['nivel'],
      }))
    }

    const text = await res.text()
    console.error(`[parcelamentos-insights] Gemini ${res.status} (tentativa ${attempt + 1}):`, text.slice(0, 500))

    if (res.status === 429) throw new Error('QUOTA_429')
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`)
    }

    lastError = new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`)
  }

  throw lastError ?? new Error('Gemini: falha após retentativas')
}

export async function GET(req: NextRequest) {
  const { unauthorized, supabase } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const fresh = req.nextUrl.searchParams.get('fresh') === 'true'

  const prevRaw = req.nextUrl.searchParams.get('prev') ?? ''
  const prevTitles = prevRaw ? prevRaw.split('||').filter(Boolean).slice(0, 4) : []

  try {
    const metrics = await computeParcelamentosMetrics(supabase)

    if (!fresh) {
      const cached = await readParcelamentosInsightsCache()
      if (cached) {
        const age = Date.now() - new Date(cached.updatedAt).getTime()
        const delta = Math.abs(metrics.totalComprometido - cached.comprometidoSnapshot)
        if (age < MAX_CACHE_AGE_MS && delta < RECALC_THRESHOLD_REAIS) {
          const response: InsightsResponse = {
            insights: cached.insights,
            updatedAt: cached.updatedAt,
            source: cached.source,
            ...(cached.fallbackReason ? { fallbackReason: cached.fallbackReason } : {}),
          }
          return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
        }
      }
    }

    let insights: InsightItem[]
    let source: 'ai' | 'fallback' = 'ai'
    let fallbackReason: string | undefined
    try {
      const payload = serializeParcelamentosCompact(metrics)
      insights = await callGemini(payload, prevTitles)
    } catch (geminiErr) {
      const reason = String(geminiErr instanceof Error ? geminiErr.message : geminiErr)
      console.error('[parcelamentos-insights] Gemini falhou, usando fallback:', reason)
      insights = generateFallbackParcelamentosInsights(metrics)
      source = 'fallback'
      fallbackReason = reason
    }

    const updatedAt = new Date().toISOString()

    await writeParcelamentosInsightsCache({
      insights,
      source,
      fallbackReason,
      comprometidoSnapshot: metrics.totalComprometido,
    })

    const response: InsightsResponse = {
      insights,
      updatedAt,
      source,
      ...(fallbackReason ? { fallbackReason } : {}),
    }

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err)
    console.error('[parcelamentos-insights] erro fatal:', msg)
    return NextResponse.json({ error: 'Falha ao gerar insights de parcelamentos', details: msg }, { status: 500 })
  }
}
