import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 20

const BUCKET = 'wishlist-images'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  )
}

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin
  const supabase = getSupabase()

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro&step=formdata`, { status: 303 })
  }

  const imageFile = formData.get('image') as File | null
  if (!imageFile || !imageFile.size) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro&step=noimage`, { status: 303 })
  }

  const arrayBuffer = await imageFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const rawExt = (imageFile.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')
  const ext = ['jpg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  // 1. Tenta upload — se o bucket não existir, continua sem imagem
  let publicUrl: string | null = null
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: imageFile.type || 'image/jpeg', upsert: false })

  if (!uploadError && uploadData) {
    publicUrl = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path).data.publicUrl
  }

  // 2. Tenta INSERT com colunas novas; se falhar (migration não rodada), usa só as base
  const payloadCompleto = {
    nome: 'Produto compartilhado',
    prioridade: 'media',
    favoritado: false,
    realizado: false,
    criado_por: 'conjunto',
    // colunas da migration v3 (podem não existir ainda)
    ...(publicUrl ? { imagem_url: publicUrl } : {}),
    ai_status: 'pendente',
    fonte: 'compartilhamento',
  }

  let itemId: string | null = null

  const { data: itemCompleto, error: errCompleto } = await supabase
    .from('wishlist_items')
    .insert([payloadCompleto])
    .select('id')
    .single()

  if (!errCompleto && itemCompleto) {
    itemId = itemCompleto.id
  } else {
    // Fallback: insert só com colunas que existem desde a v1/v2
    const payloadBase = {
      nome: 'Produto compartilhado',
      prioridade: 'media',
      favoritado: false,
      realizado: false,
      criado_por: 'conjunto',
    }
    const { data: itemBase, error: errBase } = await supabase
      .from('wishlist_items')
      .insert([payloadBase])
      .select('id')
      .single()

    if (!errBase && itemBase) {
      itemId = itemBase.id
    }
  }

  if (!itemId) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro&step=insert`, { status: 303 })
  }

  return NextResponse.redirect(
    `${origin}/wishlist/share-recebido?id=${itemId}`,
    { status: 303 }
  )
}
