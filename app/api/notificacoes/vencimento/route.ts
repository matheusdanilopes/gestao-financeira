import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addDays, startOfDay } from 'date-fns'

const PREFIXO_CARTAO_1 = '[CARTAO1] '
const PREFIXO_CARTAO_2 = '[CARTAO2] '

function limparNomeItem(nome: string): string {
  return nome.replace(PREFIXO_CARTAO_1, '').replace(PREFIXO_CARTAO_2, '').trim()
}

/**
 * POST /api/notificacoes/vencimento
 *
 * Endpoint para ser chamado por um cron job diário às 09:00.
 * Envia notificações push para despesas que vencem hoje (RN04) e amanhã (RN04).
 * Respeitará a configuração 'notificacoes_vencimento_ativas' (CA04).
 *
 * Exemplo de chamada pelo Vercel Cron (vercel.json):
 * { "path": "/api/notificacoes/vencimento", "schedule": "0 9 * * *" }
 */
export async function POST(req: NextRequest) {
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

  const hoje = startOfDay(new Date())
  const amanha = addDays(hoje, 1)
  const hojeStr = format(hoje, 'yyyy-MM-dd')
  const amanhaStr = format(amanha, 'yyyy-MM-dd')

  // Busca despesas não pagas com vencimento hoje ou amanhã
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

  const itensHoje = vencemHoje ?? []
  const itensAmanha = vencemAmanha ?? []

  if (itensHoje.length === 0 && itensAmanha.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  // Busca as push subscriptions registradas
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('usuario, subscription')

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  const mensagens: Array<{ title: string; body: string; url: string }> = []

  for (const item of itensHoje) {
    mensagens.push({
      title: '⚠️ Vencimento hoje!',
      body: `Sua conta ${limparNomeItem(item.item)} vence hoje!`,
      url: '/contas',
    })
  }

  for (const item of itensAmanha) {
    mensagens.push({
      title: '📅 Vencimento amanhã',
      body: `Sua conta ${limparNomeItem(item.item)} vence amanhã.`,
      url: '/contas',
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  let enviados = 0

  for (const sub of subscriptions) {
    for (const msg of mensagens) {
      try {
        await fetch(`${baseUrl}/api/push/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deUsuario: sub.usuario,
            payload: { title: msg.title, body: msg.body, url: msg.url },
          }),
        })
        enviados++
      } catch {
        // não interrompe o loop em caso de falha individual
      }
    }
  }

  return NextResponse.json({ ok: true, enviados })
}
