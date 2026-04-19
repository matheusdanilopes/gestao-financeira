'use client'

import { ViewTransition } from 'react'
import { usePathname } from 'next/navigation'
import NotificacoesBell from './NotificacoesBell'

const ROTAS_COM_BELL = [
  '/dashboard', '/contas', '/receitas', '/investimentos',
  '/compras', '/chat', '/configuracoes', '/importar',
]

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const mostrarBell = pathname ? ROTAS_COM_BELL.includes(pathname) : false

  return (
    <>
      {mostrarBell && (
        <div className="fixed top-3 right-3 z-50">
          <NotificacoesBell />
        </div>
      )}
      <ViewTransition
        enter={{ 'nav-forward': 'slide-from-right', 'nav-back': 'slide-from-left', default: 'fade' }}
        exit={{  'nav-forward': 'slide-to-left',    'nav-back': 'slide-to-right',  default: 'fade' }}
      >
        {children}
      </ViewTransition>
    </>
  )
}
