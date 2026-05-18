import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  )
}

async function identificarProduto(
  base64: string,
  mimeType: string
): Promise<{ nome: string; descricao: string | null; preco: number | null } | { erro: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { erro: 'GEMINI_API_KEY não configurada' }

  const prompt = `Analise a imagem e identifique o produto principal. Responda SOMENTE com um objeto JSON, sem nenhum texto antes ou depois:
{"nome":"Nome do produto, max 60 chars","descricao":"descricao curta ou null","preco":0.00}
Regras: nome max 60 chars. descricao max 100 chars ou null. preco em reais como numero (ex: 49.90) se visivel na imagem, senão null. Se nao houver produto claro, use nome "Produto compartilhado".`

  let res: Response
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    return { erro: `fetch Gemini falhou: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { erro: `Gemini HTTP ${res.status}: ${body.slice(0, 200)}` }
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    return { erro: `Resposta Gemini nao e JSON: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Concatena todos os parts de texto (modelo as vezes divide a resposta em multiplos parts)
  type GeminiResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const parts = (json as GeminiResp)?.candidates?.[0]?.content?.parts ?? []
  const fullText = parts.map(p => p.text ?? '').join('').trim()

  if (!fullText) return { erro: `Gemini texto vazio. Raw: ${JSON.stringify(json).slice(0, 300)}` }

  // Normaliza aspas tipograficas antes de extrair o JSON
  const normalised = fullText
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")

  // Greedy: pega do primeiro { ate o ultimo } (objeto JSON completo)
  const match = normalised.match(/\{[\s\S]*\}/)
  if (!match) return { erro: `Sem JSON na resposta (${fullText.length} chars): ${fullText.slice(0, 300)}` }

  try {
    const parsed = JSON.parse(match[0]) as { nome?: string; descricao?: string; preco?: number | string | null }
    if (!parsed?.nome) return { erro: `Campo nome ausente: ${match[0].slice(0, 200)}` }
    const precoRaw = parsed.preco != null ? Number(String(parsed.preco).replace(',', '.')) : null
    return {
      nome: String(parsed.nome).slice(0, 60),
      descricao: parsed.descricao ? String(parsed.descricao).slice(0, 100) : null,
      preco: precoRaw && isFinite(precoRaw) && precoRaw > 0 ? precoRaw : null,
    }
  } catch (e) {
    return { erro: `Parse falhou (${e instanceof Error ? e.message : String(e)}): ${match[0].slice(0, 200)}` }
  }
}

export async function POST(req: NextRequest) {
  let body: { id?: string; imageBase64?: string; imageMimeType?: string } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { id, imageBase64, imageMimeType } = body ?? {}
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const supabase = getSupabase()

  const { data: item, error: fetchError } = await supabase
    .from('wishlist_items')
    .select('id, imagem_url, ai_status')
    .eq('id', id)
    .single()

  if (fetchError || !item) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  if (item.ai_status === 'identificado') {
    return NextResponse.json({ status: 'identificado' })
  }

  let base64: string
  let mimeType: string

  if (imageBase64) {
    // Base64 enviado pelo cliente — não precisa baixar do storage
    base64 = imageBase64
    mimeType = imageMimeType ?? 'image/jpeg'
  } else {
    // Fallback: tenta baixar via SDK (requer policy SELECT no bucket)
    const filePath = item.imagem_url?.split('/wishlist-images/')[1]
    if (!filePath) {
      await supabase.from('wishlist_items').update({
        ai_status: 'nao_identificado',
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return NextResponse.json({ status: 'nao_identificado' })
    }

    try {
      const { data: blob, error: dlError } = await supabase.storage
        .from('wishlist-images')
        .download(filePath)
      if (dlError || !blob) throw dlError ?? new Error('empty blob')
      const imgBuffer = await blob.arrayBuffer()
      base64 = Buffer.from(imgBuffer).toString('base64')
      mimeType = blob.type || 'image/jpeg'
    } catch {
      await supabase.from('wishlist_items').update({
        ai_status: 'nao_identificado',
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return NextResponse.json({ status: 'nao_identificado' })
    }
  }

  const resultado = await identificarProduto(base64, mimeType)

  if ('erro' in resultado) {
    await supabase.from('wishlist_items').update({
      ai_status: 'nao_identificado',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ status: 'nao_identificado', debug: resultado.erro })
  }

  await supabase.from('wishlist_items').update({
    nome: resultado.nome,
    descricao_ia: resultado.descricao,
    ...(resultado.preco != null ? { valor_estimado: resultado.preco } : {}),
    ai_status: 'identificado',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  return NextResponse.json({ status: 'identificado', nome: resultado.nome, descricao: resultado.descricao, preco: resultado.preco })
}
