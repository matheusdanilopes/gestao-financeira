import { supabase } from './supabaseClient'
import { getNotificacaoMeta } from './notificationTypes'

const ACOES_NOTIFICAVEIS = ['aporte', 'pagar', 'receber']

export function nomeDoUsuario(email: string): string {
  const lower = email.toLowerCase()
  if (lower.includes('matheus')) return 'Matheus'
  if (lower.includes('jeniffer') || lower.includes('jennifer')) return 'Jeniffer'
  return email.split('@')[0]
}

export function labelAcao(acao: string): string {
  if (acao === 'aporte') return 'Aporte'
  if (acao === 'pagar') return 'Pagamento'
  if (acao === 'receber') return 'Recebimento'
  return acao
}

/**
 * Insere notificação no DB e envia push para os demais usuários.
 * A URL de destino vem do catálogo centralizado (notificationTypes.ts),
 * garantindo navegação consistente ao clicar na notificação push.
 */
export function notificar(
  acao: string,
  descricao: string,
  valor: number | undefined,
  deUsuario: string
) {
  if (!ACOES_NOTIFICAVEIS.includes(acao)) return
  const nome = nomeDoUsuario(deUsuario)
  const meta = getNotificacaoMeta(acao)

  void (async () => {
    const { data: rows, error } = await supabase.from('notificacoes').insert([{
      de_usuario: deUsuario,
      nome_usuario: nome,
      acao,
      descricao,
      valor: valor ?? null,
    }]).select('id')

    if (error || !rows?.[0]?.id) return
    const notifId = rows[0].id

    try {
      await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deUsuario,
          payload: {
            title: `${nome} registrou ${labelAcao(acao).toLowerCase()}`,
            body: descricao,
            url: meta.rota,      // rota correta por tipo
            tag: notifId,
            requireInteraction: meta.exigeInteracao,
          },
        }),
      })
    } catch (_) {}
  })()
}

export function notificarWishlist(
  itemId: string,
  nomeItem: string,
  deUsuario: string
) {
  if (!deUsuario) return
  const nome = nomeDoUsuario(deUsuario)
  const descricao = `${nome} adicionou um novo desejo na Wishlist`
  const meta = getNotificacaoMeta('wishlist_novo_item')

  void (async () => {
    const { data: rows, error } = await supabase.from('notificacoes').insert([{
      de_usuario: deUsuario,
      nome_usuario: nome,
      acao: 'wishlist_novo_item',
      descricao,
      valor: null,
      metadata: { wishlist_item_id: itemId, nome_item: nomeItem },
    }]).select('id')

    if (error || !rows?.[0]?.id) return
    const notifId = rows[0].id

    try {
      await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deUsuario,
          payload: {
            title: `${nome} adicionou na Wishlist`,
            body: nomeItem,
            url: `/wishlist?notif=${notifId}&ordem=mais-novo`,
            tag: notifId,
            requireInteraction: meta.exigeInteracao,
          },
        }),
      })
    } catch (_) {}
  })()
}

/**
 * Notifica categorização de IA concluída — ex: após processamento automático de compras.
 */
export function notificarCategorizacao(
  totalCategorizado: number,
  deUsuario: string
) {
  if (!deUsuario) return
  const nome = nomeDoUsuario(deUsuario)
  const descricao = `${totalCategorizado} compra${totalCategorizado !== 1 ? 's foram' : ' foi'} categorizada${totalCategorizado !== 1 ? 's' : ''} pela IA`
  const meta = getNotificacaoMeta('categorizacao_concluida')

  void (async () => {
    const { data: rows, error } = await supabase.from('notificacoes').insert([{
      de_usuario: deUsuario,
      nome_usuario: nome,
      acao: 'categorizacao_concluida',
      descricao,
      valor: null,
    }]).select('id')

    if (error || !rows?.[0]?.id) return
    const notifId = rows[0].id

    try {
      await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deUsuario,
          payload: {
            title: 'Categorização concluída',
            body: descricao,
            url: meta.rota,
            tag: notifId,
            requireInteraction: meta.exigeInteracao,
          },
        }),
      })
    } catch (_) {}
  })()
}
