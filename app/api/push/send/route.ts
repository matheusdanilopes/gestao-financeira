import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { requireAuth } from '@/lib/serverAuth'
import { notificarTelegramExceto } from '@/lib/telegram/notificacoes'
import type { CategoriaNotificacaoTelegram } from '@/lib/telegram/categoriasNotificacao'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

/** Tipo de aviso do Telegram de cada ação notificada pelo app (lib/notificacoes.ts). */
const CATEGORIA_TELEGRAM: Record<string, CategoriaNotificacaoTelegram> = {
  aporte: 'movimentacoes',
  pagar: 'movimentacoes',
  receber: 'movimentacoes',
  wishlist_novo_item: 'wishlist',
  categorizacao_concluida: 'importacao',
}

interface PayloadPush {
  title?: string
  body?: string
  url?: string
}

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json()
    const { payload, acao } = body as { payload?: PayloadPush; acao?: string }
    if (!payload) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    // deUsuario is always derived from the authenticated session — never from the request body
    const deUsuario = user.email ?? user.id

    // O Telegram não depende do VAPID: sai mesmo sem push configurado.
    const categoria = acao ? CATEGORIA_TELEGRAM[acao] : undefined
    const telegram = categoria && payload.title
      ? notificarTelegramExceto(categoria, deUsuario, {
          titulo: payload.title,
          corpo: payload.body,
          caminho: payload.url,
        })
      : Promise.resolve(0)

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      await telegram
      return NextResponse.json({ ok: true, skipped: 'VAPID não configurado' })
    }

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .neq('usuario', deUsuario)

    if (!subs?.length) {
      await telegram
      return NextResponse.json({ ok: true })
    }

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

    await telegram
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
