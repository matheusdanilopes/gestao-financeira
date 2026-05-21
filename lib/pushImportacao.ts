import webpush from 'web-push'
import { SupabaseClient } from '@supabase/supabase-js'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

const LABELS_PADRAO: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

function labelCartao(cartao: string, nomeCartao?: string): string {
  return nomeCartao || LABELS_PADRAO[cartao] || cartao
}

export async function notificarImportacao(
  supabase: SupabaseClient,
  tipo: 'sucesso' | 'erro',
  novas?: number,
  conflitos?: number,
  cartao: string = 'nubank',
  nomeCartao?: string
) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

  const nome = labelCartao(cartao, nomeCartao)
  let title: string
  let body: string

  if (tipo === 'sucesso') {
    const temNovas = (novas ?? 0) > 0
    const temConflitos = (conflitos ?? 0) > 0

    if (temNovas) {
      const n = novas!
      title = `${nome} — novas compras`
      body = `${n} nova${n !== 1 ? 's compras foram' : ' compra foi'} importada${n !== 1 ? 's' : ''} com sucesso.`
    } else {
      title = `${nome} — importação concluída`
      body = 'Nenhuma compra nova foi encontrada.'
    }

    if (temConflitos) {
      const c = conflitos!
      body += ` ${c} conflito${c !== 1 ? 's' : ''} de valor ${c !== 1 ? 'precisam' : 'precisa'} de revisão.`
    }
  } else {
    title = `${nome} — importação não concluída`
    body = 'Algo deu errado na importação. Acesse o app para verificar o que aconteceu.'
  }

  // Tag única por cartão: cada cartão tem sua própria notificação independente.
  // Prefixo 'importacao-sucesso-' / 'importacao-erro-' permite ao SW fechar
  // todas as notificações de importação concluída via busca por prefixo.
  const tag = tipo === 'sucesso'
    ? `importacao-sucesso-${cartao}`
    : `importacao-erro-${cartao}`

  const payload = {
    title,
    body,
    url: '/importar',
    tag,
    requireInteraction: tipo === 'erro',
  }

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
