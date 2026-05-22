import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export const maxDuration = 20

const BUCKET = 'wishlist-images'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const origin = req.nextUrl.origin

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

  if (!ALLOWED_TYPES.includes(imageFile.type)) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro&step=invalidtype`, { status: 303 })
  }

  if (imageFile.size > MAX_FILE_SIZE) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro&step=toolarge`, { status: 303 })
  }

  const arrayBuffer = await imageFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const rawExt = (imageFile.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')
  const ext = ['jpg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  let publicUrl: string | null = null
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: imageFile.type || 'image/jpeg', upsert: false })

  if (!uploadError && uploadData) {
    publicUrl = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path).data.publicUrl
  }

  const payloadCompleto = {
    nome: 'Produto compartilhado',
    prioridade: 'media',
    favoritado: false,
    realizado: false,
    criado_por: 'conjunto',
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
