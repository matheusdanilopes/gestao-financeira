import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { criarSupabaseAdmin } from '@/lib/supabaseAdmin'
import { removerPrefixoCartao } from '@/lib/tipoCartao'
import { responsavelDoEmail } from '@/lib/ai/agent/interlocutor'
import { agoraBrasil } from '@/lib/ai/tempo'
import { formatBRL } from '@/lib/format'
import { notificarTelegram, type DestinatarioTelegram } from '@/lib/telegram/notificacoes'
import { format, addDays, startOfDay } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL   = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

interface ContaAVencer {
  item: string
  responsavel: string | null
  valor_previsto: number | null
}

function limparNomeItem(nome: string): string {
  return removerPrefixoCartao(nome)
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

/** Receitas planejadas também têm data_vencimento, mas não são contas a pagar. */
const ehReceita = (c: ContaAVencer) => c.item.startsWith('[RECEITA]')

/**
 * GET|POST /api/notificacoes/vencimento
 *
 * Cron diário às 09:00 de Brasília (12:00 UTC no vercel.json) — a Vercel chama
 * crons por GET. Protegido por CRON_SECRET em Authorization: Bearer <secret>.
 *
 * Push: só as contas do próprio responsável, se "Alertas de vencimento" estiver
 * ligado em Configurações. Telegram: uma mensagem por pessoa com as contas
 * dela e as do Conjunto, conforme as preferências do Telegram de cada uma.
 */
async function executar(req: NextRequest) {
  const cronUnauthorized = requireCronSecret(req)
  if (cronUnauthorized) return cronUnauthorized

  // O cron não tem sessão: sem a service role, a RLS esconde o planejamento.
  const supabase: SupabaseClient = criarSupabaseAdmin() ?? criarSupabaseServer(req)

  const hoje   = startOfDay(agoraBrasil())
  const amanha = addDays(hoje, 1)
  const hojeStr   = format(hoje,   'yyyy-MM-dd')
  const amanhaStr = format(amanha, 'yyyy-MM-dd')

  const contasDoDia = (dia: string) =>
    supabase
      .from('planejamento')
      .select('item, responsavel, valor_previsto')
      .eq('data_vencimento', dia)
      .is('data_pagamento', null)
      .eq('pago', false)

  const [{ data: vencemHoje }, { data: vencemAmanha }] = await Promise.all([
    contasDoDia(hojeStr),
    contasDoDia(amanhaStr),
  ])

  const itensHoje   = ((vencemHoje   ?? []) as ContaAVencer[]).filter(c => !ehReceita(c))
  const itensAmanha = ((vencemAmanha ?? []) as ContaAVencer[]).filter(c => !ehReceita(c))

  if (itensHoje.length === 0 && itensAmanha.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, telegram: 0 })
  }

  const [enviados, telegram] = await Promise.all([
    enviarPush(supabase, itensHoje, itensAmanha),
    enviarTelegram(itensHoje, itensAmanha),
  ])

  return NextResponse.json({ ok: true, enviados, telegram })
}

export const GET = executar
export const POST = executar

async function enviarPush(supabase: SupabaseClient, itensHoje: ContaAVencer[], itensAmanha: ContaAVencer[]): Promise<number> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return 0

  const { data: configRow } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'notificacoes_vencimento_ativas')
    .single()

  if (configRow?.valor !== 'true') return 0

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('usuario, subscription')

  if (!subscriptions?.length) return 0

  const notificacoes = subscriptions.flatMap(sub => {
    // push_subscriptions.usuario é o e-mail; planejamento.responsavel é o nome.
    const responsavel = responsavelDoEmail(sub.usuario)
    const desteUsuario = (i: ContaAVencer) => responsavel !== null && i.responsavel === responsavel
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

  if (notificacoes.length === 0) return 0

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

  return enviados
}

function linhaConta(c: ContaAVencer, mostrarResponsavel: boolean): string {
  const valor = c.valor_previsto ? ` — ${formatBRL(Number(c.valor_previsto))}` : ''
  const dono = mostrarResponsavel && c.responsavel ? ` (${c.responsavel})` : ''
  return `• ${limparNomeItem(c.item)}${dono}${valor}`
}

function enviarTelegram(itensHoje: ContaAVencer[], itensAmanha: ContaAVencer[]): Promise<number> {
  return notificarTelegram('vencimento', (d: DestinatarioTelegram) => {
    // Sem saber quem é a pessoa, mostra tudo com o responsável de cada conta.
    const daPessoa = (c: ContaAVencer) =>
      d.responsavel === null || c.responsavel === d.responsavel || c.responsavel === 'Conjunto'
    const hoje = itensHoje.filter(daPessoa)
    const amanha = itensAmanha.filter(daPessoa)
    if (hoje.length === 0 && amanha.length === 0) return null

    const mostrarResponsavel = (c: ContaAVencer) => d.responsavel === null || c.responsavel !== d.responsavel
    const secao = (rotulo: string, contas: ContaAVencer[]) =>
      contas.length ? [`**${rotulo}**`, ...contas.map(c => linhaConta(c, mostrarResponsavel(c)))].join('\n') : ''

    return {
      titulo: hoje.length ? '⚠️ Contas vencendo hoje' : '📅 Contas vencendo amanhã',
      corpo: [secao('Hoje', hoje), secao('Amanhã', amanha)].filter(Boolean).join('\n\n'),
      caminho: '/contas',
    }
  })
}
