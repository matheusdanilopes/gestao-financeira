import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

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
      signal: AbortSignal.timeout(18000),
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

  // 1. Upload da imagem
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: imageFile.type || 'image/jpeg', upsert: false })

  if (uploadError) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path)

  // 2. Análise IA (síncrona — resultado em ~5-15s, dentro do maxDuration)
  const imageBase64 = buffer.toString('base64')
  const mimeType = imageFile.type || 'image/jpeg'
  const resultado = await identificarProduto(imageBase64, mimeType)

  const aiStatus = resultado ? 'identificado' : 'nao_identificado'
  const nome = resultado?.nome ?? 'Produto compartilhado'
  const descricao = resultado?.descricao ?? null

  // 3. Cria o item já com o resultado final
  const { data: item, error: insertError } = await supabase
    .from('wishlist_items')
    .insert([{
      nome,
      prioridade: 'media',
      favoritado: false,
      realizado: false,
      ai_status: aiStatus,
      imagem_url: publicUrl,
      fonte: 'compartilhamento',
      criado_por: 'conjunto',
      nota: descricao,
    }])
    .select('id')
    .single()

  if (insertError || !item) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  return NextResponse.redirect(
    `${origin}/wishlist/share-recebido?id=${item.id}&status=${aiStatus}`,
    { status: 303 }
  )
}
