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
): Promise<{ nome: string; descricao: string | null } | { erro: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { erro: 'GEMINI_API_KEY não configurada' }

  const prompt = `Você é um assistente de lista de desejos. Analise a imagem e identifique o produto principal.

Regras:
- nome: nome claro e objetivo do produto, máximo 60 caracteres. Se não houver produto claro, use "Produto compartilhado".
- descricao: descrição curta (modelo, cor, marca), máximo 100 caracteres. Deixe vazio se não souber.`

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
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              nome:     { type: 'string' },
              descricao: { type: 'string' },
            },
            required: ['nome'],
          },
        },
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
    return { erro: `Resposta Gemini não é JSON: ${e instanceof Error ? e.message : String(e)}` }
  }

  const text = ((json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()

  if (!text) return { erro: `Gemini texto vazio. Resposta: ${JSON.stringify(json).slice(0, 300)}` }

  // Extrai o primeiro {…} da resposta — ignora qualquer prefixo textual do modelo
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { erro: `Nenhum JSON encontrado: ${text.slice(0, 200)}` }

  try {
    const parsed = JSON.parse(match[0]) as { nome?: string; descricao?: string }
    if (!parsed?.nome) return { erro: `Campo nome ausente: ${match[0].slice(0, 200)}` }
    return {
      nome: String(parsed.nome).slice(0, 60),
      descricao: parsed.descricao ? String(parsed.descricao).slice(0, 100) : null,
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
    ai_status: 'identificado',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  return NextResponse.json({ status: 'identificado', nome: resultado.nome, descricao: resultado.descricao })
}
