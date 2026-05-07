'use client'

import { usePathname } from 'next/navigation'
import NotificacoesBell from './NotificacoesBell'
import DataStatusIndicator from './DataStatusIndicator'
import { useRefreshContext } from './RefreshProvider'

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

  const mostrarBell = pathname ? ROTAS_COM_BELL.includes(pathname) : false
  const mostrarRefresh = pathname ? ROTAS_COM_REFRESH.includes(pathname) : false

  return (
    <>
      {(mostrarBell || (mostrarRefresh && syncState)) && (
        <div className="fixed top-3 right-3 lg:top-2.5 lg:right-6 z-50 flex items-center gap-2">
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
      {children}
    </>
  )
}
