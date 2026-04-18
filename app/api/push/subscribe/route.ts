import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  try {
    const { usuario, subscription } = await req.json()
    if (!usuario || !subscription) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const supabase = criarSupabaseServer(req)
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert([{ usuario, subscription }], { onConflict: 'usuario' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
