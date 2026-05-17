import { NextRequest, NextResponse } from 'next/server'

const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.imageBase64) {
    return NextResponse.json({ error: 'Imagem não fornecida' }, { status: 400 })
  }

  const { imageBase64, mimeType = 'image/jpeg' } = body

  const prompt = `Você é um OCR especializado em etiquetas de supermercado. Analise a imagem e retorne o preço de venda do produto.

Regras:
- Retorne APENAS o valor numérico com ponto como separador decimal, sem símbolo de moeda
- Em etiquetas promocionais "DE R$X POR R$Y", retorne o preço atual de venda (menor valor)
- Se não conseguir identificar um preço claro, retorne: null

Exemplos: "R$ 12,99" → 12.99 | "R$ 3,50" → 3.50 | "DE R$15,00 POR R$9,90" → 9.90

Responda APENAS com o número ou null.`

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }

  const json = await res.json()
  const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()

  if (!text || text.toLowerCase() === 'null') {
    return NextResponse.json({ preco: null })
  }

  const preco = parseFloat(text)
  return NextResponse.json({ preco: isNaN(preco) ? null : preco })
}
