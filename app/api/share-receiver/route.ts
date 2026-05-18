import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 25

const BUCKET = 'wishlist-images'
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
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
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
  const origin = req.nextUrl.origin
  const supabase = getSupabase()

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  const imageFile = formData.get('image') as File | null
  if (!imageFile || !imageFile.size) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  const arrayBuffer = await imageFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const rawExt = (imageFile.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')
  const ext = ['jpg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: imageFile.type || 'image/jpeg', upsert: false })

  if (uploadError) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path)

  const { data: item, error: insertError } = await supabase
    .from('wishlist_items')
    .insert([{
      nome: 'Produto compartilhado',
      prioridade: 'media',
      favoritado: false,
      realizado: false,
      ai_status: 'pendente',
      imagem_url: publicUrl,
      fonte: 'compartilhamento',
    }])
    .select('id')
    .single()

  if (insertError || !item) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  // Processa IA após a resposta ser enviada ao browser (after é estável no Next.js 15+/16)
  const itemId = item.id
  const imageBase64 = buffer.toString('base64')
  const mimeType = imageFile.type || 'image/jpeg'

  after(async () => {
    const resultado = await identificarProduto(imageBase64, mimeType)
    const update = resultado
      ? { nome: resultado.nome, descricao_ia: resultado.descricao, ai_status: 'identificado' }
      : { nome: 'Produto compartilhado', ai_status: 'nao_identificado' }

    await supabase
      .from('wishlist_items')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', itemId)
  })

  return NextResponse.redirect(`${origin}/wishlist/share-recebido?id=${itemId}`, { status: 303 })
}
