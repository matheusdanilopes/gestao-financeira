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

  // 2. Cria o item imediatamente com status pendente
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
      criado_por: 'conjunto',
    }])
    .select('id')
    .single()

  if (insertError || !item) {
    return NextResponse.redirect(`${origin}/wishlist/share-recebido?status=erro`, { status: 303 })
  }

  // 3. Redireciona imediatamente — análise IA é disparada pelo cliente
  return NextResponse.redirect(
    `${origin}/wishlist/share-recebido?id=${item.id}`,
    { status: 303 }
  )
}
