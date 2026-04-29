import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { criarSupabaseServer } from '@/lib/supabaseServer'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

export async function POST(req: NextRequest) {
  try {
    const { deUsuario, payload } = await req.json()
    if (!deUsuario || !payload) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return NextResponse.json({ ok: true, skipped: 'VAPID não configurado' })
    }

    const supabase = criarSupabaseServer(req)
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .neq('usuario', deUsuario)

    if (!subs?.length) return NextResponse.json({ ok: true })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(sub.subscription, JSON.stringify(payload), {
          urgency: 'high',
          TTL: 86400,
        })
      )
    )

    const expiradas = subs
      .filter((_, i) => {
        const r = results[i]
        if (r.status !== 'rejected') return false
        const status = (r.reason as { statusCode?: number })?.statusCode
        return status === 410 || status === 404
      })
      .map(sub => sub.usuario)

    if (expiradas.length) {
      await supabase.from('push_subscriptions').delete().in('usuario', expiradas)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
