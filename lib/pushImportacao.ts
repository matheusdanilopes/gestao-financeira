import webpush from 'web-push'
import { SupabaseClient } from '@supabase/supabase-js'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

export async function notificarImportacao(
  supabase: SupabaseClient,
  tipo: 'sucesso' | 'erro',
  novas?: number,
  conflitos?: number
) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

  let title: string
  let body: string

  if (tipo === 'sucesso') {
    const temNovas = (novas ?? 0) > 0
    const temConflitos = (conflitos ?? 0) > 0

    if (temNovas) {
      const n = novas!
      title = 'Novas compras importadas'
      body = `${n} nova${n !== 1 ? 's compras foram' : ' compra foi'} importada${n !== 1 ? 's' : ''} com sucesso.`
    } else {
      title = 'Importação concluída'
      body = 'Nenhuma compra nova foi encontrada.'
    }

    if (temConflitos) {
      const c = conflitos!
      body += ` ${c} conflito${c !== 1 ? 's' : ''} de valor ${c !== 1 ? 'precisam' : 'precisa'} de revisão.`
    }
  } else {
    title = 'Importação não concluída'
    body = 'Algo deu errado na importação. Acesse o app para verificar o que aconteceu.'
  }

  const payload = { title, body, url: '/importar', tag: 'importacao' }

  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('*')
    if (!subs?.length) return

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
  } catch { /* falha no push nunca deve interromper a resposta */ }
}
