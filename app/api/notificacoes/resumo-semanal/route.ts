import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { subDays, startOfDay, format } from 'date-fns'

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL   = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

interface Transacao {
  valor: number
  responsavel: string
  categoria: string
}

interface PushSubscriptionRow {
  usuario: string
  subscription: Parameters<typeof webpush.sendNotification>[0]
}

/**
 * POST /api/notificacoes/resumo-semanal
 *
 * Endpoint para cron job às segundas-feiras às 09:00.
 * Protegido por CRON_SECRET em Authorization: Bearer <secret>
 * vercel.json: { "path": "/api/notificacoes/resumo-semanal", "schedule": "0 9 * * 1" }
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
    .eq('chave', 'notificacoes_resumo_semanal_ativas')
    .single()

  if (configRow?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'notificacoes_desativadas' })
  }

  const hoje       = startOfDay(new Date())
  const seteDiasAtras = subDays(hoje, 7)
  const hojeStr       = format(hoje, 'yyyy-MM-dd')
  const seteDiasStr   = format(seteDiasAtras, 'yyyy-MM-dd')

  const [{ data: transacoes }, { data: subscriptions }] = await Promise.all([
    supabase
      .from('transacoes_nubank')
      .select('valor, responsavel, categoria')
      .gte('data_compra', seteDiasStr)
      .lt('data_compra', hojeStr)
      .not('status', 'in', '("ESTORNO","ESTORNADO")'),
    supabase
      .from('push_subscriptions')
      .select('usuario, subscription'),
  ])

  if (!transacoes?.length || !subscriptions?.length) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  // Group by responsavel
  const porResponsavel = new Map<string, Transacao[]>()
  for (const t of transacoes as Transacao[]) {
    const lista = porResponsavel.get(t.responsavel) ?? []
    lista.push(t)
    porResponsavel.set(t.responsavel, lista)
  }

  function calcResumo(lista: Transacao[]): { totalGasto: number; topCategoria: string } {
    const totalGasto = lista.reduce((acc, t) => acc + t.valor, 0)
    const porCategoria = new Map<string, number>()
    for (const t of lista) {
      porCategoria.set(t.categoria, (porCategoria.get(t.categoria) ?? 0) + t.valor)
    }
    let topCategoria = ''
    let topValor = -Infinity
    for (const [cat, val] of porCategoria) {
      if (val > topValor) {
        topValor = val
        topCategoria = cat
      }
    }
    return { totalGasto, topCategoria }
  }

  const notificacoes = (subscriptions as PushSubscriptionRow[]).flatMap(sub => {
    const lista = porResponsavel.get(sub.usuario)
    if (!lista?.length) return []
    const { totalGasto, topCategoria } = calcResumo(lista)
    return [{
      sub,
      msg: {
        title: '📊 Resumo semanal',
        body: `Você gastou R$ ${totalGasto.toFixed(2)} esta semana. Principal: ${topCategoria}`,
        url: '/compras',
        tag: 'resumo-semanal',
        requireInteraction: false,
      },
    }]
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
          url: msg.url,
          tag: msg.tag,
          requireInteraction: msg.requireInteraction,
        }),
        { urgency: 'normal', TTL: 86400 }
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
