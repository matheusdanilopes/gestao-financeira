'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Receipt, TrendingUp, ShoppingCart, MessageCircle, SlidersHorizontal, PiggyBank, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { useCategorizacao } from '@/components/CategorizacaoProvider'

const ROTAS_COM_MENU = ['/dashboard', '/contas', '/receitas', '/investimentos', '/compras', '/chat', '/configuracoes', '/importar']

const navItems = [
  { href: '/dashboard',      label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/contas',         label: 'Despesas',    icon: Receipt },
  { href: '/receitas',       label: 'Receitas',    icon: TrendingUp },
  { href: '/investimentos',  label: 'Investir',    icon: PiggyBank },
  { href: '/compras',        label: 'Compras',     icon: ShoppingCart },
  { href: '/chat',           label: 'IA',          icon: MessageCircle },
  { href: '/configuracoes',  label: 'Config',      icon: SlidersHorizontal },
]

export default function BottomNav() {
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
    <div data-bottom-nav="true" className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
      {categorizando && (
        <div className="flex items-center justify-center gap-1.5 bg-purple-50 border-b border-purple-100 py-1 text-xs text-purple-700 font-medium">
          <Sparkles className="w-3 h-3 animate-pulse" />
          Categorizando com IA...
        </div>
      )}
      <div className="flex justify-around items-center h-16 px-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-0.5 flex-1 py-2 transition-all"
            >
              <span className={`flex items-center justify-center w-10 h-6 rounded-full transition-all ${
                isActive ? 'bg-blue-100' : ''
              }`}>
                <Icon
                  className={`transition-all ${isActive ? 'w-5 h-5 text-blue-600' : 'w-5 h-5 text-gray-400'}`}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
              </span>
              <span className={`text-[10px] font-medium transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-400'
              }`}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
