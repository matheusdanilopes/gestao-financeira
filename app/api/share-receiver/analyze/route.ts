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
): Promise<{ nome: string; descricao: string | null } | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const prompt = `Você é um assistente de lista de desejos. Analise a imagem e identifique o produto principal.

Retorne APENAS um JSON válido neste formato (sem markdown, sem código):
{"nome":"Nome do Produto","descricao":"Descrição breve ou null"}

Regras:
- nome: nome claro e objetivo do produto, máximo 60 caracteres
- descricao: descrição curta (modelo, cor, marca), máximo 100 caracteres, null se não souber
- Se a imagem não mostrar produto claro: {"nome":"Produto compartilhado","descricao":null}

Responda SOMENTE com o JSON.`

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) return null

    const json = await res.json()
    const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(clean)
    if (!parsed?.nome) return null
    return {
      nome: String(parsed.nome).slice(0, 60),
      descricao: parsed.descricao ? String(parsed.descricao).slice(0, 100) : null,
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  let body: { id?: string } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { id } = body ?? {}
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

  if (item.ai_status !== 'pendente') {
    return NextResponse.json({ status: item.ai_status })
  }

  // Extrai o caminho do arquivo a partir da URL pública
  // Formato: https://<project>.supabase.co/storage/v1/object/public/wishlist-images/<filename>
  const filePath = item.imagem_url.split('/wishlist-images/')[1]

  if (!filePath) {
    await supabase.from('wishlist_items').update({
      ai_status: 'nao_identificado',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ status: 'nao_identificado' })
  }

  // Download via SDK Supabase — não depende de acesso HTTP público ao bucket
  let base64: string
  let mimeType: string
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

  const resultado = await identificarProduto(base64, mimeType)

  if (resultado) {
    await supabase.from('wishlist_items').update({
      nome: resultado.nome,
      descricao_ia: resultado.descricao,
      ai_status: 'identificado',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ status: 'identificado', nome: resultado.nome, descricao: resultado.descricao })
  }

  await supabase.from('wishlist_items').update({
    nome: 'Produto compartilhado',
    ai_status: 'nao_identificado',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  return NextResponse.json({ status: 'nao_identificado' })
}
