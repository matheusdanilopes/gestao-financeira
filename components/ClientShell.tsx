'use client'

import { usePathname } from 'next/navigation'
import NotificacoesBell from './NotificacoesBell'
import { useEffect, useRef, useState } from 'react'

const ROTAS_COM_BELL = [
  '/dashboard', '/contas', '/receitas', '/investimentos',
  '/compras', '/chat', '/configuracoes', '/importar',
]

const NAV_ORDER = [
  '/dashboard', '/contas', '/receitas', '/investimentos',
  '/compras', '/chat', '/configuracoes',
]

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const mostrarBell = pathname ? ROTAS_COM_BELL.includes(pathname) : false
  const prevRef = useRef<string | null>(null)
  const [animClass, setAnimClass] = useState('')

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = pathname

    if (prev === null || prev === pathname) return

    const prevIdx = NAV_ORDER.indexOf(prev)
    const currIdx = NAV_ORDER.indexOf(pathname ?? '')
    if (prevIdx === -1 || currIdx === -1) return

    const cls = currIdx > prevIdx ? 'page-enter-from-right' : 'page-enter-from-left'
    setAnimClass(cls)
    const t = setTimeout(() => setAnimClass(''), 320)
    return () => clearTimeout(t)
  }, [pathname])

  return (
    <>
      {mostrarBell && (
        <div className="fixed top-3 right-3 z-50">
          <NotificacoesBell />
        </div>
      )}
      <div className={animClass || undefined}>
        {children}
      </div>
    </>
  )
}
