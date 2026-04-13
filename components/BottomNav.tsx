'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ListChecks, Upload, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'

const ROTAS_COM_MENU = ['/dashboard', '/contas', '/receitas', '/compras', '/importar', '/configuracoes']

export default function BottomNav() {
  const pathname = usePathname()
  const [session, setSession] = useState<Session | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function carregarSessao() {
      const { data } = await supabase.auth.getSession()
      if (isMounted) {
        setSession(data.session)
        setIsCheckingSession(false)
      }
    }

    carregarSessao()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
      setIsCheckingSession(false)
    })

    return () => {
      isMounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/contas', label: 'Despesas', icon: ListChecks },
    { href: '/receitas', label: 'Receitas', icon: ListChecks },
    { href: '/compras', label: 'Compras', icon: ListChecks },
    { href: '/importar', label: 'Importar', icon: Upload },
    { href: '/configuracoes', label: 'Config', icon: Settings },
  ]

  const deveExibirMenu = pathname ? ROTAS_COM_MENU.includes(pathname) : false

  if (!deveExibirMenu) {
    return null
  }

  if (!AUTH_DISABLED && (isCheckingSession || !session)) {
    return null
  }

  return (
    <div data-bottom-nav="true" className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
      <div className="flex justify-around items-center h-16">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 transition ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs">{label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
