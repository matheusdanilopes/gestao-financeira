import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { data, error } = await supabase.from('configuracoes').select('chave, valor')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ configuracoes: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { configuracoes } = await req.json()

    const { error } = await supabase
      .from('configuracoes')
      .upsert(configuracoes, { onConflict: 'chave' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
