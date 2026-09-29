import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { criarSupabaseAdmin } from '@/lib/supabaseAdmin'
import { responsavelDoEmail } from '@/lib/ai/agent/interlocutor'
import { agoraBrasil } from '@/lib/ai/tempo'
import { subDays, startOfDay, format } from 'date-fns'
import { formatBRL } from '@/lib/format'
import { notificarTelegram } from '@/lib/telegram/notificacoes'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

interface Resumo {
  totalGasto: number
  totalTransacoes: number
  /** Categorias da maior para a menor. */
  categorias: [string, number][]
}

function calcResumo(lista: Transacao[]): Resumo {
  const totalGasto = lista.reduce((acc, t) => acc + Number(t.valor), 0)
  const porCategoria = new Map<string, number>()
  for (const t of lista) {
    if (t.categoria) porCategoria.set(t.categoria, (porCategoria.get(t.categoria) ?? 0) + Number(t.valor))
  }
  const categorias = [...porCategoria.entries()].sort((a, b) => b[1] - a[1])
  return { totalGasto, totalTransacoes: lista.length, categorias }
}

function tendencia(atual: number, anterior: number): string {
  if (anterior === 0) return ''
  const diff = ((atual - anterior) / anterior) * 100
  if (Math.abs(diff) < 3) return 'Igual à semana passada'
  const sinal = diff > 0 ? '↑' : '↓'
  return `${sinal} ${Math.abs(diff).toFixed(0)}% vs semana passada`
}

const plural = (n: number) => `${n} compra${n !== 1 ? 's' : ''}`

/**
 * GET|POST /api/notificacoes/resumo-semanal
 *
 * Cron às segundas às 09:00 de Brasília (12:00 UTC no vercel.json) — a Vercel
 * chama crons por GET. Protegido por CRON_SECRET em Authorization: Bearer <secret>.
 *
 * Push: só se a configuração notificacoes_resumo_semanal_ativas for 'true'.
 * Telegram: conforme as preferências do Telegram de cada pessoa.
 */
async function executar(req: NextRequest) {
  const cronUnauthorized = requireCronSecret(req)
  if (cronUnauthorized) return cronUnauthorized

  // O cron não tem sessão: sem a service role, a RLS esconde as transações.
  const supabase: SupabaseClient = criarSupabaseAdmin() ?? criarSupabaseServer(req)

  const hoje            = startOfDay(agoraBrasil())
  const seteDiasAtras   = subDays(hoje, 7)
  const quatorzeAtras   = subDays(hoje, 14)
  const hojeStr         = format(hoje, 'yyyy-MM-dd')
  const seteDiasStr     = format(seteDiasAtras, 'yyyy-MM-dd')
  const quatorzeStr     = format(quatorzeAtras, 'yyyy-MM-dd')

  const [{ data: transacoes }, { data: transacoesAnterior }] = await Promise.all([
    supabase
      .from('transacoes_nubank')
      .select('valor, responsavel, categoria')
      .gte('data_compra', seteDiasStr)
      .lt('data_compra', hojeStr)
      .not('status', 'in', '("ESTORNO","ESTORNADO")'),
    supabase
      .from('transacoes_nubank')
      .select('valor, responsavel')
      .gte('data_compra', quatorzeStr)
      .lt('data_compra', seteDiasStr)
      .not('status', 'in', '("ESTORNO","ESTORNADO")'),
  ])

  if (!transacoes?.length) {
    return NextResponse.json({ ok: true, enviados: 0, telegram: 0 })
  }

  // Group current week by responsavel
  const porResponsavel = new Map<string, Transacao[]>()
  for (const t of transacoes as Transacao[]) {
    const lista = porResponsavel.get(t.responsavel) ?? []
    lista.push(t)
    porResponsavel.set(t.responsavel, lista)
  }

  // Group previous week totals by responsavel
  const totalAnteriorPorResponsavel = new Map<string, number>()
  for (const t of (transacoesAnterior ?? []) as { valor: number; responsavel: string }[]) {
    totalAnteriorPorResponsavel.set(t.responsavel, (totalAnteriorPorResponsavel.get(t.responsavel) ?? 0) + Number(t.valor))
  }

  const [enviados, telegram] = await Promise.all([
    enviarPush(supabase, porResponsavel, totalAnteriorPorResponsavel),
    enviarTelegram(transacoes as Transacao[], porResponsavel, totalAnteriorPorResponsavel),
  ])

  return NextResponse.json({ ok: true, enviados, telegram })
}

export const GET = executar
export const POST = executar

async function enviarPush(
  supabase: SupabaseClient,
  porResponsavel: Map<string, Transacao[]>,
  totalAnteriorPorResponsavel: Map<string, number>
): Promise<number> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return 0

  const { data: configRow } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'notificacoes_resumo_semanal_ativas')
    .single()

  if (configRow?.valor !== 'true') return 0

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('usuario, subscription')

  if (!subscriptions?.length) return 0

  const notificacoes = (subscriptions as PushSubscriptionRow[]).flatMap(sub => {
    // push_subscriptions.usuario é o e-mail; transacoes_nubank.responsavel é o nome.
    const nome = responsavelDoEmail(sub.usuario)
    const lista = nome ? porResponsavel.get(nome) : undefined
    if (!nome || !lista?.length) return []
    const { totalGasto, categorias, totalTransacoes } = calcResumo(lista)
    const anterior = totalAnteriorPorResponsavel.get(nome) ?? 0
    const trend = tendencia(totalGasto, anterior)
    const [top] = categorias
    const topInfo = top ? `${top[0]} foi o maior gasto (${formatBRL(top[1])})` : ''
    const partes = [trend, topInfo, `${plural(totalTransacoes)} no total`].filter(Boolean)
    return [{
      sub,
      msg: {
        title: `${nome}, sua semana custou ${formatBRL(totalGasto)}`,
        body: partes.join(' · '),
        url: '/compras',
        tag: 'resumo-semanal',
        requireInteraction: false,
      },
    }]
  })

  if (notificacoes.length === 0) return 0

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

  return enviados
}

function enviarTelegram(
  todas: Transacao[],
  porResponsavel: Map<string, Transacao[]>,
  totalAnteriorPorResponsavel: Map<string, number>
): Promise<number> {
  return notificarTelegram('resumo_semanal', d => {
    const nome = d.responsavel
    // Sem saber quem é a pessoa, o resumo é do casal inteiro.
    const lista = nome ? porResponsavel.get(nome) ?? [] : todas
    const conjunto = nome ? porResponsavel.get('Conjunto') ?? [] : []
    if (lista.length === 0 && conjunto.length === 0) return null

    const { totalGasto, categorias, totalTransacoes } = calcResumo(lista)
    const anterior = nome
      ? totalAnteriorPorResponsavel.get(nome) ?? 0
      : [...totalAnteriorPorResponsavel.values()].reduce((a, v) => a + v, 0)

    const linhas: string[] = []
    const trend = tendencia(totalGasto, anterior)
    linhas.push([plural(totalTransacoes), trend].filter(Boolean).join(' · '))
    if (categorias.length) {
      linhas.push('', '**Maiores categorias**')
      for (const [cat, valor] of categorias.slice(0, 3)) linhas.push(`• ${cat} — ${formatBRL(valor)}`)
    }
    if (conjunto.length) {
      const c = calcResumo(conjunto)
      linhas.push('', `No Conjunto: ${formatBRL(c.totalGasto)} em ${plural(c.totalTransacoes)}.`)
    }

    return {
      titulo: nome
        ? `📊 ${nome}, sua semana custou ${formatBRL(totalGasto)}`
        : `📊 A semana de vocês custou ${formatBRL(totalGasto)}`,
      corpo: linhas.join('\n'),
      caminho: '/compras',
    }
  })
}
