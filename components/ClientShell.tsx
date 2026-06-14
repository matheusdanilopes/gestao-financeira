'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import NotificacoesBell from './NotificacoesBell'
import DataStatusIndicator from './DataStatusIndicator'
import { useRefreshContext } from './RefreshProvider'
import { useOnline } from '@/lib/useOnline'
import BottomNav from './BottomNav'
import { useNotificationAutoClear } from '@/lib/notificationRouter'

// Rotas que mostram sino de notificações
const ROTAS_COM_BELL = [
  '/dashboard', '/contas', '/receitas', '/investimentos',
  '/compras', '/configuracoes', '/importar',
]

// Rotas que mostram o indicador de atualização (todas as com bell, exceto /chat)
const ROTAS_COM_REFRESH = [
  '/dashboard', '/contas', '/receitas', '/investimentos', '/compras',
]

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { syncState } = useRefreshContext()
  const isOnline = useOnline()

  // Registra o SW globalmente em todas as rotas para garantir cache offline
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {})
  }, [])

  // Fecha notificações de importação concluída ao abrir o app (cold start)
  // e ao retornar do background. Nunca fecha notificações de erro.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    function notifyAppOpened() {
      navigator.serviceWorker.ready
        .then(reg => reg.active?.postMessage({ type: 'APP_OPENED' }))
        .catch(() => {})
    }

    notifyAppOpened()

    function handleVisibility() {
      if (document.visibilityState === 'visible') notifyAppOpened()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // Auto-clear: marca notificações do contexto atual como lidas ao navegar
  useNotificationAutoClear(pathname ?? '')

  const mostrarBell = pathname ? ROTAS_COM_BELL.includes(pathname) : false
  const mostrarRefresh = pathname ? ROTAS_COM_REFRESH.includes(pathname) : false

  // pb-16 = nav bar (64px); pb-24 = nav bar + offline banner (~88px).
  // Transição CSS suaviza a mudança de padding para evitar layout shift brusco.
  const mainPb = isOnline ? 'pb-16' : 'pb-24'

  return (
    <>
      {(mostrarBell || (mostrarRefresh && syncState)) && (
        <div className="fixed top-[calc(0.75rem+var(--safe-top))] right-3 lg:top-[calc(0.625rem+var(--safe-top))] lg:right-6 z-50 flex items-center gap-2">
          {mostrarRefresh && syncState && (
            <DataStatusIndicator
              status={syncState.status}
              lastUpdated={syncState.lastUpdated}
              onRefresh={syncState.refetch}
            />
          )}
          {mostrarBell && <NotificacoesBell />}
        </div>
      )}
      <main className={`w-full max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-7xl mx-auto relative lg:pt-14 lg:pb-0 main-pb-transition ${mainPb}`}>
        {children}
      </main>
      <BottomNav />
    </>
  )
}
