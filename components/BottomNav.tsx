'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Receipt, TrendingUp, ShoppingCart, MessageCircle,
  SlidersHorizontal, PiggyBank, Sparkles, BarChart3, Plus, MoreHorizontal, Wallet, CreditCard, RepeatIcon,
  Heart, ShoppingBasket,
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { useCategorizacao } from '@/components/CategorizacaoProvider'
import ModalPortal from '@/components/ModalPortal'
import FabQuickLaunchSheet from '@/components/FabQuickLaunchSheet'

const ROTAS_COM_MENU = [
  '/dashboard', '/contas', '/receitas', '/investimentos', '/assinaturas',
  '/compras', '/chat', '/configuracoes', '/importar', '/financas', '/extras',
  '/wishlist', '/lista-mercado',
]

const ROTAS_FINANCAS = ['/financas', '/contas', '/receitas', '/investimentos']
const ROTAS_CARTAO   = ['/compras', '/assinaturas']
const ROTAS_EXTRAS   = ['/extras', '/chat', '/configuracoes', '/wishlist', '/lista-mercado']

const desktopItems = [
  { href: '/dashboard',     label: 'Dashboard',    icon: LayoutDashboard,   desktopOnly: false },
  { href: '/contas',        label: 'Despesas',      icon: Receipt,           desktopOnly: false },
  { href: '/receitas',      label: 'Receitas',      icon: TrendingUp,        desktopOnly: false },
  { href: '/investimentos', label: 'Investir',      icon: PiggyBank,         desktopOnly: false },
  { href: '/compras',       label: 'Compras',       icon: ShoppingCart,      desktopOnly: false },
  { href: '/assinaturas',   label: 'Assinaturas',   icon: RepeatIcon,        desktopOnly: false },
  { href: '/wishlist',      label: 'Wishlist',      icon: Heart,             desktopOnly: false },
  { href: '/lista-mercado', label: 'Mercado',       icon: ShoppingBasket,    desktopOnly: false },
  { href: '/chat',          label: 'IA',            icon: MessageCircle,     desktopOnly: false },
  { href: '/configuracoes', label: 'Config',        icon: SlidersHorizontal, desktopOnly: false },
  { href: '/analytics',     label: 'Analytics',     icon: BarChart3,         desktopOnly: true  },
]

// ── Sub-menus ─────────────────────────────────────────────────────────────────

function FinancasMenuPopover({ onClose, router }: { onClose: () => void; router: ReturnType<typeof useRouter> }) {
  const opcoes = [
    { tab: 'despesas',      label: 'Despesas',      Icon: Receipt,    cor: 'text-red-500',   bg: 'bg-red-50'   },
    { tab: 'receitas',      label: 'Receitas',      Icon: TrendingUp, cor: 'text-green-600', bg: 'bg-green-50' },
    { tab: 'investimentos', label: 'Investimentos', Icon: PiggyBank,  cor: 'text-blue-600',  bg: 'bg-blue-50'  },
  ]

  return (
    <div className="fixed bottom-[72px] left-3 z-[51] modal-center">
      <div className="bg-white rounded-3xl shadow-float border border-gray-100 overflow-hidden w-56">
        {opcoes.map(({ tab, label, Icon, cor, bg }, i) => (
          <button
            key={tab}
            type="button"
            onClick={() => { router.push(`/financas?tab=${tab}`); onClose() }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50
                        active:bg-gray-100 transition-colors duration-150
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400
                        ${i < opcoes.length - 1 ? 'border-b border-gray-100' : ''}`}
          >
            <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4 h-4 ${cor}`} strokeWidth={1.8} />
            </div>
            <span className="text-sm font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function CartaoMenuPopover({ onClose, router }: { onClose: () => void; router: ReturnType<typeof useRouter> }) {
  const opcoes = [
    { href: '/compras',      label: 'Compras',      Icon: ShoppingCart, cor: 'text-orange-500', bg: 'bg-orange-50' },
    { href: '/assinaturas',  label: 'Assinaturas',  Icon: RepeatIcon,   cor: 'text-indigo-600', bg: 'bg-indigo-50' },
  ]

  return (
    <div className="fixed bottom-[72px] right-14 z-[51] modal-center">
      <div className="bg-white rounded-3xl shadow-float border border-gray-100 overflow-hidden w-56">
        {opcoes.map(({ href, label, Icon, cor, bg }, i) => (
          <button
            key={href}
            type="button"
            onClick={() => { router.push(href); onClose() }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50
                        active:bg-gray-100 transition-colors duration-150
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400
                        ${i < opcoes.length - 1 ? 'border-b border-gray-100' : ''}`}
          >
            <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4 h-4 ${cor}`} strokeWidth={1.8} />
            </div>
            <span className="text-sm font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}


function ExtrasMenuPopover({ onClose, router }: { onClose: () => void; router: ReturnType<typeof useRouter> }) {
  const opcoes = [
    { href: '/wishlist',      label: 'Wishlist',      Icon: Heart,             cor: 'text-pink-500',    bg: 'bg-pink-50'    },
    { href: '/lista-mercado', label: 'Lista Mercado', Icon: ShoppingBasket,    cor: 'text-green-600',   bg: 'bg-green-50'   },
    { href: '/chat',          label: 'IA Assistant',  Icon: MessageCircle,     cor: 'text-primary-600', bg: 'bg-primary-50' },
    { href: '/configuracoes', label: 'Configurações', Icon: SlidersHorizontal, cor: 'text-gray-600',    bg: 'bg-gray-100'   },
  ]

  return (
    <div className="fixed bottom-[72px] right-3 z-[51] modal-center">
      <div className="bg-white rounded-3xl shadow-float border border-gray-100 overflow-hidden w-56">
        {opcoes.map(({ href, label, Icon, cor, bg }, i) => (
          <button
            key={href}
            type="button"
            onClick={() => { router.push(href); onClose() }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50
                        active:bg-gray-100 transition-colors duration-150
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400
                        ${i < opcoes.length - 1 ? 'border-b border-gray-100' : ''}`}
          >
            <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4 h-4 ${cor}`} strokeWidth={1.8} />
            </div>
            <span className="text-sm font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Nav item button (Finanças / Extras) ───────────────────────────────────────

function MobileMenuButton({
  label, icon: Icon, isActive, onClick, ariaExpanded,
}: {
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  isActive: boolean
  onClick: () => void
  ariaExpanded: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                 focus-visible:ring-offset-1 rounded-xl transition-all duration-200"
    >
      <span className={`flex items-center justify-center w-10 h-6 rounded-full transition-all duration-200
                        ${isActive ? 'bg-primary-100' : ''}`}>
        <Icon
          className={`transition-all duration-200 w-[20px] h-[20px]
                      ${isActive ? 'text-primary-600' : 'text-gray-400'}`}
          strokeWidth={isActive ? 2.5 : 1.8}
        />
      </span>
      <span className={`text-[10px] font-medium transition-colors duration-200 leading-none
                        ${isActive ? 'text-primary-600' : 'text-gray-400'}`}>
        {label}
      </span>
    </button>
  )
}

// ── Nav item link (Dashboard / Compras) ───────────────────────────────────────

function MobileNavItem({
  href, label, icon: Icon, isActive,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  isActive: boolean
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                 focus-visible:ring-offset-1 rounded-xl transition-all duration-200"
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={`flex items-center justify-center w-10 h-6 rounded-full transition-all duration-200
                        ${isActive ? 'bg-primary-100' : ''}`}>
        <Icon
          className={`transition-all duration-200 w-[20px] h-[20px]
                      ${isActive ? 'text-primary-600' : 'text-gray-400'}`}
          strokeWidth={isActive ? 2.5 : 1.8}
        />
      </span>
      <span className={`text-[10px] font-medium transition-colors duration-200 leading-none
                        ${isActive ? 'text-primary-600' : 'text-gray-400'}`}>
        {label}
      </span>
    </Link>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default memo(function BottomNav() {
  const pathname = usePathname()
  const router   = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [openMenu, setOpenMenu] = useState<'financas' | 'cartao' | 'extras' | null>(null)
  const [fabSheetOpen, setFabSheetOpen] = useState(false)
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

  // Fecha menus ao navegar para outra rota
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenMenu(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFabSheetOpen(false)
  }, [pathname])

  const deveExibirMenu = pathname ? ROTAS_COM_MENU.some(r => pathname === r || pathname.startsWith(r + '/')) : false

  if (!deveExibirMenu) return null
  if (!AUTH_DISABLED && (isCheckingSession || !session)) return null

  const isFinancasActive = ROTAS_FINANCAS.some(r => pathname === r || pathname.startsWith(r + '/'))
  const isCartaoActive   = ROTAS_CARTAO.some(r => pathname === r || pathname.startsWith(r + '/'))
  const isExtrasActive   = ROTAS_EXTRAS.some(r => pathname === r || pathname.startsWith(r + '/'))

  return (
    <div
      data-bottom-nav="true"
      className="fixed bottom-0 left-0 right-0 z-[50]
                 lg:bottom-auto lg:top-0 lg:border-b lg:border-t-0"
    >
      {categorizando && (
        <div className="flex items-center justify-center gap-1.5 bg-violet-50 border-b border-violet-100 py-1.5 text-xs text-violet-600 font-medium">
          <Sparkles className="w-3 h-3 animate-pulse" />
          Categorizando com IA…
        </div>
      )}

      <nav aria-label="Navegação principal">
        {/* ── Mobile: 5 itens com FAB central ──────────────────────────────── */}
        <div className="flex lg:hidden justify-around items-center h-16 px-1">
          <MobileNavItem
            href="/dashboard"
            label="Dashboard"
            icon={LayoutDashboard}
            isActive={pathname === '/dashboard'}
          />

          <MobileMenuButton
            label="Finanças"
            icon={Wallet}
            isActive={isFinancasActive || openMenu === 'financas'}
            ariaExpanded={openMenu === 'financas'}
            onClick={() => setOpenMenu(p => p === 'financas' ? null : 'financas')}
          />

          {/* FAB — central de lançamento rápido */}
          <button
            type="button"
            aria-label={fabSheetOpen ? 'Fechar menu' : 'Lançamento rápido'}
            aria-expanded={fabSheetOpen}
            onClick={() => {
              setOpenMenu(null)
              setFabSheetOpen(p => !p)
            }}
            className="flex flex-col items-center justify-center flex-none -mt-5 group"
          >
            <span className={`w-14 h-14 rounded-full flex items-center justify-center
                              fab-premium
                              ${fabSheetOpen ? 'fab-premium-active' : ''}
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2`}>
              <Plus
                className={`w-6 h-6 text-white transition-transform duration-300
                            ${fabSheetOpen ? 'rotate-45' : ''}`}
                strokeWidth={2.5}
              />
            </span>
            <span className="text-[10px] font-medium text-gray-400 mt-0.5 leading-none">
              Adicionar
            </span>
          </button>

          <MobileMenuButton
            label="Cartão"
            icon={CreditCard}
            isActive={isCartaoActive || openMenu === 'cartao'}
            ariaExpanded={openMenu === 'cartao'}
            onClick={() => setOpenMenu(p => p === 'cartao' ? null : 'cartao')}
          />

          <MobileMenuButton
            label="Extras"
            icon={MoreHorizontal}
            isActive={isExtrasActive || openMenu === 'extras'}
            ariaExpanded={openMenu === 'extras'}
            onClick={() => setOpenMenu(p => p === 'extras' ? null : 'extras')}
          />
        </div>

        {/* ── Desktop: barra superior com todos os itens ────────────────────── */}
        <div className="hidden lg:flex justify-start items-center h-14 px-4 gap-1">
          {desktopItems.map(({ href, label, icon: Icon, desktopOnly }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`
                  ${desktopOnly ? 'hidden md:flex' : 'flex'}
                  flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl flex-none
                  transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  className={`w-4 h-4 transition-all duration-200 ${isActive ? 'text-primary-600' : 'text-gray-500'}`}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
                <span className={`text-[13px] font-medium leading-none transition-colors duration-200
                                  ${isActive ? 'text-primary-600' : 'text-gray-600'}`}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>

        {/* ── Menus flutuantes via portal ────────────────────────────────────── */}
        {openMenu && (
          <ModalPortal>
            <div
              className="fixed inset-0 z-[49] modal-overlay"
              style={{ background: 'rgba(0,0,0,0.25)' }}
              onClick={() => setOpenMenu(null)}
              aria-hidden="true"
            />
            {openMenu === 'financas' && (
              <FinancasMenuPopover onClose={() => setOpenMenu(null)} router={router} />
            )}
            {openMenu === 'cartao' && (
              <CartaoMenuPopover onClose={() => setOpenMenu(null)} router={router} />
            )}
            {openMenu === 'extras' && (
              <ExtrasMenuPopover onClose={() => setOpenMenu(null)} router={router} />
            )}
          </ModalPortal>
        )}

        {/* ── FAB Quick Launch Sheet ─────────────────────────────────────────── */}
        {fabSheetOpen && (
          <FabQuickLaunchSheet onClose={() => setFabSheetOpen(false)} />
        )}
      </nav>
    </div>
  )
})
