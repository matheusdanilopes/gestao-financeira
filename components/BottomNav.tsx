'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Receipt, TrendingUp, ShoppingCart, MessageCircle, SlidersHorizontal, PiggyBank, Sparkles } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { useCategorizacao } from '@/components/CategorizacaoProvider'

const ROTAS_COM_MENU = ['/dashboard', '/contas', '/receitas', '/investimentos', '/assinaturas', '/compras', '/chat', '/configuracoes', '/importar']

const navItems = [
  { href: '/dashboard',      label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/contas',         label: 'Despesas',    icon: Receipt },
  { href: '/receitas',       label: 'Receitas',    icon: TrendingUp },
  { href: '/investimentos',  label: 'Investir',    icon: PiggyBank },
  { href: '/compras',        label: 'Compras',     icon: ShoppingCart },
  { href: '/chat',           label: 'IA',          icon: MessageCircle },
  { href: '/configuracoes',  label: 'Config',      icon: SlidersHorizontal },
]

export default memo(function BottomNav() {
  const pathname = usePathname()
  const [session, setSession] = useState<Session | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const { categorizando } = useCategorizacao()

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

  const deveExibirMenu = pathname ? ROTAS_COM_MENU.includes(pathname) : false

  if (!deveExibirMenu) return null
  if (!AUTH_DISABLED && (isCheckingSession || !session)) return null

  return (
    <div data-bottom-nav="true" className="fixed bottom-0 left-0 right-0 z-[50]">
      {categorizando && (
        <div className="flex items-center justify-center gap-1.5 bg-violet-50 border-b border-violet-100 py-1.5 text-xs text-violet-600 font-medium">
          <Sparkles className="w-3 h-3 animate-pulse" />
          Categorizando com IA…
        </div>
      )}
      <nav aria-label="Navegação principal">
        <div className="flex justify-around items-center h-16 px-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 rounded-xl"
                aria-current={isActive ? 'page' : undefined}
              >
                <span className={`flex items-center justify-center w-9 h-6 rounded-full transition-all duration-200 ${
                  isActive ? 'bg-primary-100' : ''
                }`}>
                  <Icon
                    className={`transition-all duration-200 ${isActive ? 'w-[18px] h-[18px] text-primary-600' : 'w-[18px] h-[18px] text-gray-400'}`}
                    strokeWidth={isActive ? 2.5 : 1.8}
                  />
                </span>
                <span className={`text-[11px] font-medium transition-colors duration-200 leading-none ${
                  isActive ? 'text-primary-600' : 'text-gray-400'
                }`}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
})
