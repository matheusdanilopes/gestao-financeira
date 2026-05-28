import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addDays, startOfDay } from 'date-fns'

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL   = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

const PREFIXO_CARTAO_1 = '[CARTAO1] '
const PREFIXO_CARTAO_2 = '[CARTAO2] '

function limparNomeItem(nome: string): string {
  return nome.replace(PREFIXO_CARTAO_1, '').replace(PREFIXO_CARTAO_2, '').trim()
}

function slugItem(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .slice(0, 40)
}

/**
 * POST /api/notificacoes/vencimento
 *
 * Endpoint para cron job diário às 09:00.
 * Protegido por CRON_SECRET em Authorization: Bearer <secret>
 * vercel.json: { "path": "/api/notificacoes/vencimento", "schedule": "0 9 * * *" }
 */
export async function POST(req: NextRequest) {
  const cronUnauthorized = requireCronSecret(req)
  if (cronUnauthorized) return cronUnauthorized

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json({ ok: true, skipped: 'VAPID não configurado' })
  }

  const supabase = criarSupabaseServer(req)

  const { data: configRow } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'notificacoes_vencimento_ativas')
    .single()

  if (configRow?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'notificacoes_desativadas' })
  }

  const hoje   = startOfDay(new Date())
  const amanha = addDays(hoje, 1)
  const hojeStr   = format(hoje,   'yyyy-MM-dd')
  const amanhaStr = format(amanha, 'yyyy-MM-dd')

  const [{ data: vencemHoje }, { data: vencemAmanha }, { data: subscriptions }] =
    await Promise.all([
      supabase
        .from('planejamento')
        .select('item, responsavel')
        .eq('data_vencimento', hojeStr)
        .is('data_pagamento', null)
        .eq('pago', false),
      supabase
        .from('planejamento')
        .select('item, responsavel')
        .eq('data_vencimento', amanhaStr)
        .is('data_pagamento', null)
        .eq('pago', false),
      supabase
        .from('push_subscriptions')
        .select('usuario, subscription'),
    ])

  const itensHoje   = vencemHoje   ?? []
  const itensAmanha = vencemAmanha ?? []

  if ((itensHoje.length === 0 && itensAmanha.length === 0) || !subscriptions?.length) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  const notificacoes = subscriptions.flatMap(sub => {
    const desteUsuario = (i: { responsavel: string }) => i.responsavel === sub.usuario
    const msgsHoje = itensHoje.filter(desteUsuario).map(item => {
      const nome = limparNomeItem(item.item)
      return {
        title: '⚠️ Vencimento hoje!',
        body:  `Sua conta ${nome} vence hoje!`,
        tag:   `conta-atrasada-${slugItem(nome)}`,
        requireInteraction: true,
      }
    })
    const msgsAmanha = itensAmanha.filter(desteUsuario).map(item => {
      const nome = limparNomeItem(item.item)
      return {
        title: '📅 Vencimento amanhã',
        body:  `Sua conta ${nome} vence amanhã.`,
        tag:   `conta-vencendo-${slugItem(nome)}`,
        requireInteraction: true,
      }
    })
    return [...msgsHoje, ...msgsAmanha].map(msg => ({ sub, msg }))
  })

  if (notificacoes.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  const results = await Promise.allSettled(
    notificacoes.map(({ sub, msg }) =>
      webpush.sendNotification(
        sub.subscription,
        JSON.stringify({
          title: msg.title,
          body: msg.body,
          url: '/contas',
          tag: msg.tag,
          requireInteraction: msg.requireInteraction,
        }),
        { urgency: 'high', TTL: 86400 }
      )
    )
  )

  let enviados = 0
  const expiradas = new Set<string>()

  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      enviados++
    } else {
      const status = (res.reason as { statusCode?: number })?.statusCode
      if (status === 410 || status === 404) expiradas.add(notificacoes[i].sub.usuario)
    }
  })

  if (expiradas.size > 0) {
    await supabase.from('push_subscriptions').delete().in('usuario', Array.from(expiradas))
  }

  return NextResponse.json({ ok: true, enviados })
}
