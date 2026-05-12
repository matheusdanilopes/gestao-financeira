import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
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

/**
 * POST /api/notificacoes/vencimento
 *
 * Endpoint para cron job diário às 09:00.
 * Envia push direto às subscriptions (sem passar pelo /api/push/send que tem filtro neq).
 * Respeitará 'notificacoes_vencimento_ativas' (CA04).
 *
 * vercel.json: { "path": "/api/notificacoes/vencimento", "schedule": "0 9 * * *" }
 */
export async function POST(req: NextRequest) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json({ ok: true, skipped: 'VAPID não configurado' })
  }

  const supabase = criarSupabaseServer(req)

  // CA04: verifica se notificações estão ativas
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

  const [{ data: vencemHoje }, { data: vencemAmanha }] = await Promise.all([
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
  ])

  const itensHoje   = vencemHoje   ?? []
  const itensAmanha = vencemAmanha ?? []

  if (itensHoje.length === 0 && itensAmanha.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('usuario, subscription')

  if (!subscriptions?.length) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  const mensagens: Array<{ title: string; body: string }> = []

  for (const item of itensHoje) {
    mensagens.push({
      title: '⚠️ Vencimento hoje!',
      body:  `Sua conta ${limparNomeItem(item.item)} vence hoje!`,
    })
  }
  for (const item of itensAmanha) {
    mensagens.push({
      title: '📅 Vencimento amanhã',
      body:  `Sua conta ${limparNomeItem(item.item)} vence amanhã.`,
    })
  }

  let enviados = 0
  const expiradas: string[] = []

  for (const sub of subscriptions) {
    for (const msg of mensagens) {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({ title: msg.title, body: msg.body, url: '/contas' }),
          { urgency: 'high', TTL: 86400 }
        )
        enviados++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 410 || status === 404) expiradas.push(sub.usuario)
      }
    }
  }

  // Remove subscriptions expiradas
  if (expiradas.length) {
    await supabase.from('push_subscriptions').delete().in('usuario', expiradas)
  }

  return NextResponse.json({ ok: true, enviados })
}
