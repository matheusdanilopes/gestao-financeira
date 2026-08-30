import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json()
    const { subscription } = body as { subscription?: unknown }
    if (!subscription) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    // usuario is always the authenticated user's email — never from the request body
    const usuario = user.email ?? user.id

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert([{ usuario, subscription }], { onConflict: 'usuario' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
