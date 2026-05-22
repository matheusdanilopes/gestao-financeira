import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export const maxDuration = 20

const BUCKET = 'wishlist-images'
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BASE64_BYTES = 10 * 1024 * 1024 // ~7.5 MB decoded

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: { id?: string; imageBase64?: string; imageMimeType?: string } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo invalido' }, { status: 400 })
  }

  const { id, imageBase64, imageMimeType } = body ?? {}
  if (!id || !imageBase64) {
    return NextResponse.json({ error: 'id e imageBase64 obrigatorios' }, { status: 400 })
  }

  const mimeType = imageMimeType ?? 'image/jpeg'
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Tipo de imagem não permitido' }, { status: 400 })
  }

  if (imageBase64.length > MAX_BASE64_BYTES) {
    return NextResponse.json({ error: 'Imagem muito grande' }, { status: 413 })
  }

  const buffer = Buffer.from(imageBase64, 'base64')
  const rawExt = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const ext = ['jpg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg'
  // Randomised filename prevents enumeration of other users' uploads
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: mimeType, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path).data.publicUrl

  await supabase.from('wishlist_items').update({
    imagem_url: publicUrl,
    fonte: 'compartilhamento',
    ai_status: 'pendente',
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ publicUrl })
}
