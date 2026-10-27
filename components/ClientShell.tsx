'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { useOnline } from '@/lib/useOnline'
import BottomNav from './BottomNav'
import AlertaFaturaController from './AlertaFaturaController'
import WakeWordListener from './WakeWordListener'
import { useNotificationAutoClear } from '@/lib/notificationRouter'

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
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

  // pb-16 = nav bar (64px); pb-24 = nav bar + offline banner (~88px).
  // Transição CSS suaviza a mudança de padding para evitar layout shift brusco.
  const mainPb = isOnline ? 'pb-16' : 'pb-24'

  return (
    <>
      <main className={`w-full max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-7xl mx-auto relative lg:pt-14 lg:pb-0 main-pb-transition ${mainPb}`}>
        {children}
      </main>
      <BottomNav />
      <AlertaFaturaController />
      <WakeWordListener />
    </>
  )
}
