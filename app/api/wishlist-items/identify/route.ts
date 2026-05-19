import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const VALID_CATEGORIAS = ['Eletrônicos', 'Casa', 'Moda', 'Viagem', 'Lazer', 'Esporte', 'Saúde', 'Educação', 'Outros']

export async function POST(req: NextRequest) {
  let body: { imageBase64?: string; imageMimeType?: string } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { imageBase64, imageMimeType } = body ?? {}
  if (!imageBase64) {
    return NextResponse.json({ error: 'imageBase64 obrigatório' }, { status: 400 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 503 })
  }

  const prompt = `Analise a imagem e identifique o produto principal. Responda SOMENTE com um objeto JSON válido:
{"nome":"Nome do produto","descricao":"descricao breve ou null","preco":0.00,"categoria":"categoria ou null"}
Regras: nome max 60 chars obrigatório. descricao max 100 chars ou null. preco em reais como numero (ex: 49.90) se visível, senão null. categoria deve ser uma de [Eletrônicos, Casa, Moda, Viagem, Lazer, Esporte, Saúde, Educação, Outros] ou null. Se nao houver produto claro, use nome "Produto identificado".`

  let geminiRes: Response
  try {
    geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: imageMimeType ?? 'image/jpeg', data: imageBase64 } },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    return NextResponse.json({ error: `Gemini falhou: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  if (!geminiRes.ok) {
    const txt = await geminiRes.text().catch(() => '')
    return NextResponse.json({ error: `Gemini HTTP ${geminiRes.status}: ${txt.slice(0, 200)}` }, { status: 502 })
  }

  let json: unknown
  try { json = await geminiRes.json() } catch {
    return NextResponse.json({ error: 'Resposta Gemini inválida' }, { status: 502 })
  }

  type GeminiResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const parts = (json as GeminiResp)?.candidates?.[0]?.content?.parts ?? []
  const fullText = parts.map((p: { text?: string }) => p.text ?? '').join('').trim()
  if (!fullText) return NextResponse.json({ error: 'Gemini retornou vazio' }, { status: 502 })

  const normalised = fullText.replace(/[""„‟«»]/g, '"').replace(/[''‚‛]/g, "'")
  const match = normalised.match(/\{[\s\S]*\}/)
  if (!match) return NextResponse.json({ error: 'Sem JSON na resposta' }, { status: 502 })

  try {
    const parsed = JSON.parse(match[0]) as { nome?: string; descricao?: string | null; preco?: number | string | null; categoria?: string | null }
    if (!parsed?.nome) return NextResponse.json({ error: 'Campo nome ausente' }, { status: 502 })
    const precoRaw = parsed.preco != null ? Number(String(parsed.preco).replace(',', '.')) : null
    const categoriaRaw = typeof parsed.categoria === 'string' ? parsed.categoria : null
    return NextResponse.json({
      nome: String(parsed.nome).slice(0, 60),
      descricao: parsed.descricao ? String(parsed.descricao).slice(0, 100) : null,
      preco: precoRaw && isFinite(precoRaw) && precoRaw > 0 ? precoRaw : null,
      categoria: categoriaRaw && VALID_CATEGORIAS.includes(categoriaRaw) ? categoriaRaw : null,
    })
  } catch {
    return NextResponse.json({ error: 'Parse do JSON falhou' }, { status: 502 })
  }
}
