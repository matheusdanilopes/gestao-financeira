import webpush from 'web-push'
import { nomeDoUsuario } from './notificacoes'
import { criarSupabaseServer } from './supabaseServer'

type SupabaseServer = ReturnType<typeof criarSupabaseServer>

export type ItemNotificacao = {
  nome: string
  quantidade: number
  unit: string
}

export async function notificarListaMercadoServer(
  supabase: SupabaseServer,
  items: ItemNotificacao[],
  deUsuario: string
) {
  if (!deUsuario || !items.length) return

  const nome = nomeDoUsuario(deUsuario)

  let title: string
  let body: string
  if (items.length === 1) {
    title = `🛒 ${nome} adicionou à lista`
    body = `${items[0].nome} — ${items[0].quantidade} ${items[0].unit}`
  } else {
    title = `🛒 ${nome} adicionou ${items.length} itens`
    body = items.map(i => `• ${i.nome} — ${i.quantidade} ${i.unit}`).join('\n')
  }

  try {
    const { data: rows } = await supabase
      .from('notificacoes')
      .insert([{
        de_usuario: deUsuario,
        nome_usuario: nome,
        acao: 'lista_item_adicionado',
        descricao: body,
        valor: null,
        metadata: { items },
      }])
      .select('id')

    const notifId: string = rows?.[0]?.id ?? ''

    const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
    const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .neq('usuario', deUsuario)

    if (!subs?.length) return

    const payload = JSON.stringify({
      title,
      body,
      url: notifId ? `/lista-mercado?notif=${notifId}` : '/lista-mercado',
      tag: 'lista-mercado-novo-item',
      requireInteraction: false,
    })

    const results = await Promise.allSettled(
      subs.map((sub: { usuario: string; subscription: webpush.PushSubscription }) =>
        webpush.sendNotification(sub.subscription, payload, {
          urgency: 'normal',
          TTL: 3600,
        })
      )
    )

    const expiradas = subs
      .filter((_: unknown, i: number) => {
        const r = results[i]
        if (r.status !== 'rejected') return false
        const status = (r.reason as { statusCode?: number })?.statusCode
        return status === 410 || status === 404
      })
      .map((sub: { usuario: string }) => sub.usuario)

    if (expiradas.length) {
      await supabase.from('push_subscriptions').delete().in('usuario', expiradas)
    }
  } catch {
    // Notification failure is non-fatal
  }
}

export async function registrarHistoricoServer(
  supabase: SupabaseServer,
  params: {
    item_id: string | null
    action: 'created' | 'updated' | 'deleted' | 'checked' | 'unchecked'
    user_id: string | null
    criado_por: string | null
    item_nome: string | null
    old_values?: Record<string, unknown>
    new_values?: Record<string, unknown>
  }
) {
  try {
    await supabase.from('lista_mercado_historico').insert([{
      item_id: params.item_id,
      action: params.action,
      user_id: params.user_id,
      criado_por: params.criado_por,
      item_nome: params.item_nome,
      old_values: params.old_values ?? null,
      new_values: params.new_values ?? null,
    }])
  } catch {
    // History logging is non-fatal
  }
}
