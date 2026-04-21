'use client'

import { usePathname } from 'next/navigation'
import NotificacoesBell from './NotificacoesBell'

const ROTAS_COM_BELL = [
  '/dashboard', '/contas', '/receitas', '/investimentos',
  '/compras', '/chat', '/configuracoes', '/importar',
]

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const mostrarBell = pathname ? ROTAS_COM_BELL.includes(pathname) : false
  const bellPositionClass = pathname === '/chat' ? 'top-16' : 'top-3'

  return (
    <>
      {mostrarBell && (
        <div className={`fixed right-3 z-50 ${bellPositionClass}`}>
          <NotificacoesBell />
        </div>
      )}
      {children}
    </>
  )
}
