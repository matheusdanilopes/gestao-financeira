import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const mes = req.nextUrl.searchParams.get('mes')
    const ate = req.nextUrl.searchParams.get('ate')

    let query = supabase.from('limites_parcelamentos').select('mes_referencia, responsavel, valor')
    if (mes) query = query.eq('mes_referencia', mes)
    else if (ate) query = query.lte('mes_referencia', ate)

    const { data, error } = await query.order('mes_referencia', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ limites: data ?? [] })
  } catch {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { limites } = await req.json()

    if (!Array.isArray(limites)) {
      return NextResponse.json({ error: 'limites deve ser um array' }, { status: 400 })
    }

    const { error } = await supabase
      .from('limites_parcelamentos')
      .upsert(limites, { onConflict: 'mes_referencia,responsavel' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
