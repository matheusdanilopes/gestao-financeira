import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { requireAuth } from '@/lib/serverAuth'

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL   = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

/**
 * POST /api/push/test
 * Envia uma notificação de teste para o próprio usuário autenticado.
 */
export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json({ error: 'VAPID não configurado no servidor' }, { status: 503 })
  }

  const usuario = user.email ?? user.id

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('usuario', usuario)
    .single()

  if (!sub?.subscription) {
    return NextResponse.json({ error: 'Nenhuma subscrição ativa encontrada. Ative as notificações primeiro.' }, { status: 404 })
  }

  try {
    await webpush.sendNotification(
      sub.subscription,
      JSON.stringify({
        title: 'Notificação de teste',
        body: 'As notificações estão funcionando corretamente!',
        url: '/configuracoes',
        tag: 'teste-notificacao',
        requireInteraction: false,
      }),
      { urgency: 'high', TTL: 60 }
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 410 || status === 404) {
      await supabase.from('push_subscriptions').delete().eq('usuario', usuario)
      return NextResponse.json(
        { error: 'Subscrição expirada. Desative e reative as notificações.' },
        { status: 410 }
      )
    }
    return NextResponse.json({ error: 'Falha ao enviar notificação de teste' }, { status: 500 })
  }
}
