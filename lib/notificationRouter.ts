'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from './supabaseClient'
import { getNotificacaoMeta, ROTA_PARA_ACOES } from './notificationTypes'
import { AUTH_DISABLED } from './authConfig'

export interface NotificacaoMinima {
  id: string
  acao: string
  metadata?: Record<string, unknown> | null
}

/** Constrói a URL de destino para uma notificação (com query params de contexto). */
export function buildNotifUrl(notif: NotificacaoMinima): string {
  const meta = getNotificacaoMeta(notif.acao)
  if (meta.rotaFn) {
    return meta.rotaFn(notif.metadata as Record<string, unknown> | null | undefined)
  }
  return meta.rota
}

/** Envia mensagem ao SW para fechar notificações push pelos seus IDs/tags. */
export function fecharPushPorIds(ids: string[]) {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator) || !ids.length) return
  navigator.serviceWorker.ready
    .then(reg => reg.active?.postMessage({ type: 'CLOSE_NOTIFICATIONS', tags: ids }))
    .catch(() => {})
}

/**
 * Hook que retorna função de navegação para notificações.
 * Marca como lida, fecha push e navega para a rota correta.
 */
export function useNotificationNavigation() {
  const router = useRouter()

  return async function navegarPara(
    notif: NotificacaoMinima,
    marcarLida: (id: string) => Promise<void>
  ): Promise<void> {
    if (notif.acao === 'conciliacao_conflito') return // resolvido inline no bell

    await marcarLida(notif.id)
    const url = buildNotifUrl(notif)
    router.push(url)
  }
}

/**
 * Hook de auto-limpeza de notificações por rota.
 * Chamado pelo ClientShell a cada mudança de pathname.
 * Marca como lidas (via Supabase) as notificações do contexto atual,
 * fecha os pushes correspondentes e aciona o realtime do bell via UPDATE.
 */
export function useNotificationAutoClear(pathname: string) {
  useEffect(() => {
    const acoes = ROTA_PARA_ACOES[pathname]
    if (!acoes?.length) return

    async function limpar() {
      let email: string | null = null

      if (AUTH_DISABLED) {
        email = 'demo@demo.com'
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        email = user?.email ?? null
      }

      if (!email) return

      // Busca IDs não-lidos para fechar no SW também
      const { data: unread } = await supabase
        .from('notificacoes')
        .select('id')
        .neq('de_usuario', email)
        .in('acao', acoes)
        .eq('lida', false)

      if (!unread?.length) return

      const ids = unread.map(n => n.id as string)

      // Marca como lido — dispara UPDATE no Realtime → bell atualiza badge
      await supabase
        .from('notificacoes')
        .update({ lida: true })
        .in('id', ids)

      // Fecha pushes correspondentes no tray do OS
      fecharPushPorIds(ids)
    }

    void limpar()
  }, [pathname])
}
