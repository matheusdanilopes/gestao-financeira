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

  const supabase = getSupabase()

  const buffer = Buffer.from(imageBase64, 'base64')
  const rawExt = (imageMimeType ?? 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const ext = ['jpg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: imageMimeType ?? 'image/jpeg', upsert: false })

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
