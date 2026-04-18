import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { criarSupabaseServer } from '@/lib/supabaseServer'

// Chaves VAPID — sobrescrevíveis via variáveis de ambiente
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  || 'BDnHVc8WTIUWZKjh2tuazldgVjCXrhN8FrsZHfovhmIhW1Rm5_j-iDWtzEqrAQMzogD7KvBd9sgFkkQpV34tO-M'
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
  || 'wJTEve6GvIgw0cl3NS1XRGMWIIszXj1pOl7N2cMhizQ'
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)

export async function POST(req: NextRequest) {
  try {
    const { deUsuario, payload } = await req.json()
    if (!deUsuario || !payload) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const supabase = criarSupabaseServer(req)
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .neq('usuario', deUsuario)

    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const results = await Promise.allSettled(
      subs.map(sub => webpush.sendNotification(sub.subscription, JSON.stringify(payload)))
    )

    const enviados = results.filter(r => r.status === 'fulfilled').length
    const erros = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => String(r.reason))

    if (erros.length) console.error('[push/send] Erros:', erros)

    return NextResponse.json({ ok: true, sent: enviados })
  } catch (err) {
    console.error('[push/send]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
