import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { data, error } = await supabase.from('configuracoes').select('chave, valor')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ configuracoes: data ?? [] })
  } catch {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { configuracoes } = await req.json()

    if (!Array.isArray(configuracoes)) {
      return NextResponse.json({ error: 'configuracoes deve ser um array' }, { status: 400 })
    }

    const { error } = await supabase
      .from('configuracoes')
      .upsert(configuracoes, { onConflict: 'chave' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
