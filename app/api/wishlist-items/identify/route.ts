import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { gerarRodada, GEMINI_MODEL_LEGADO } from '@/lib/ai/agent/geminiClient'

export const maxDuration = 30

const VALID_CATEGORIAS = ['Eletrônicos', 'Casa', 'Moda', 'Viagem', 'Lazer', 'Esporte', 'Saúde', 'Educação', 'Outros']
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BASE64_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

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

  const mimeType = imageMimeType ?? 'image/jpeg'
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Tipo de imagem não permitido' }, { status: 400 })
  }

  if (imageBase64.length > MAX_BASE64_BYTES) {
    return NextResponse.json({ error: 'Imagem muito grande' }, { status: 413 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 503 })
  }

  const prompt = `Analise a imagem e identifique o produto principal. Responda SOMENTE com um objeto JSON válido:
{"nome":"Nome do produto","descricao":"descricao breve ou null","preco":0.00,"categoria":"categoria ou null"}
Regras: nome max 60 chars obrigatório. descricao max 100 chars ou null. preco em reais como numero (ex: 49.90) se visível, senão null. categoria deve ser uma de [Eletrônicos, Casa, Moda, Viagem, Lazer, Esporte, Saúde, Educação, Outros] ou null. Se nao houver produto claro, use nome "Produto identificado".`

  // Gemini com retentativas; se ele falhar, o Groq (visão) responde.
  let fullText: string
  try {
    const rodada = await gerarRodada({
      apiKey,
      modelo: GEMINI_MODEL_LEGADO,
      deadlineMs: Date.now() + 25_000,
      temperature: 0.1,
      maxOutputTokens: 512,
      thinkingBudget: 0,
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
    })
    fullText = rodada.texto.trim()
  } catch (err) {
    console.error('[wishlist-identify] IA indisponível:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Serviço de IA indisponível' }, { status: 502 })
  }
  if (!fullText) return NextResponse.json({ error: 'IA retornou vazio' }, { status: 502 })

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
