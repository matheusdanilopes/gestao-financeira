import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { gerarRodada, GEMINI_MODEL_LEGADO } from '@/lib/ai/agent/geminiClient'

export const maxDuration = 30

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BASE64_BYTES = 10 * 1024 * 1024 // ~7.5 MB decoded

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  let body: { imageBase64?: string; mimeType?: string } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido' }, { status: 400 })
  }

  if (!body?.imageBase64) {
    return NextResponse.json({ error: 'Imagem não fornecida' }, { status: 400 })
  }

  const { imageBase64, mimeType = 'image/jpeg' } = body

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Tipo de imagem não permitido' }, { status: 400 })
  }

  if (imageBase64.length > MAX_BASE64_BYTES) {
    return NextResponse.json({ error: 'Imagem muito grande' }, { status: 413 })
  }

  const prompt = `Você é um OCR especializado em etiquetas de supermercado. Analise a imagem e retorne o preço de venda do produto.

Regras:
- Retorne APENAS o valor numérico com ponto como separador decimal, sem símbolo de moeda
- Em etiquetas promocionais "DE R$X POR R$Y", retorne o preço atual de venda (menor valor)
- Se não conseguir identificar um preço claro, retorne: null

Exemplos: "R$ 12,99" → 12.99 | "R$ 3,50" → 3.50 | "DE R$15,00 POR R$9,90" → 9.90

Responda APENAS com o número ou null.`

  // Gemini com retentativas; se ele falhar, o Groq (visão) responde.
  let text: string
  try {
    const rodada = await gerarRodada({
      apiKey,
      modelo: GEMINI_MODEL_LEGADO,
      deadlineMs: Date.now() + 25_000,
      temperature: 0,
      maxOutputTokens: 32,
      thinkingBudget: 0,
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
    })
    text = rodada.texto.trim()
  } catch (err) {
    console.error('[ocr-preco] IA indisponível:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Serviço de OCR indisponível' }, { status: 502 })
  }

  if (!text || text.toLowerCase() === 'null') {
    return NextResponse.json({ preco: null })
  }

  const preco = parseFloat(text)
  return NextResponse.json({ preco: isNaN(preco) ? null : preco })
}
