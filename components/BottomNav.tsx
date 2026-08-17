'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Sparkles, Plus, MoreHorizontal, WifiOff, ChevronDown, ShoppingBasket, FileSpreadsheet, X,
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { useCategorizacao } from '@/components/CategorizacaoProvider'
import { useImportacaoScript } from '@/components/ImportacaoScriptProvider'
import { useOnline } from '@/lib/useOnline'
import ModalPortal from '@/components/ModalPortal'
import FabQuickLaunchSheet from '@/components/FabQuickLaunchSheet'
import { NAV_MODULES, type NavModuleItem, type NavModuleKey } from '@/lib/navModules'

const ROTAS_COM_MENU = [
  '/dashboard', '/financas', '/contas', '/receitas', '/investimentos',
  '/compras', '/assinaturas', '/parcelamentos',
  '/wishlist', '/lista-mercado', '/lista-mercado/historico', '/listas-compras',
  '/relatorios', '/analytics', '/chat', '/configuracoes', '/importar',
]

// Rotas acessíveis sem conexão. Critério: não só ter cache de leitura
// (várias telas têm, via useGlobalSync/localStorage), mas também suas escritas
// serem seguras offline — enfileiradas e sincronizadas depois, nunca perdidas
// nem falhando em silêncio. Hoje só a Lista de Mercado tem essa fila
// (lib/offlineQueue.ts); '/listas-compras' usa apenas cache de leitura — criar/
// renomear/arquivar/excluir lista ou item falha ali sem enfileirar nada, então
// fica de fora daqui até ganhar o mesmo suporte.
const ROTAS_OFFLINE = ['/dashboard', '/lista-mercado']

const ROTAS_FINANCAS = ['/financas', '/contas', '/receitas', '/investimentos']
const ROTAS_CARTAO   = ['/compras', '/assinaturas', '/parcelamentos']
const ROTAS_LISTAS   = ['/wishlist', '/lista-mercado', '/listas-compras']
const ROTAS_RELATORIOS = ['/relatorios', '/analytics']
// União de tudo que hoje mora dentro do popover "Extras" no mobile.
const ROTAS_EXTRAS = [...ROTAS_LISTAS, ...ROTAS_RELATORIOS, '/chat', '/configuracoes']

// Sucesso some sozinho depois de um tempo — erro fica visível até o usuário
// dispensar ou visitar /importar, onde o painel completo assume.
const IMPORT_BAND_AUTO_HIDE_MS = 8000

const IMPORT_BAND_ESTILOS: Record<'running' | 'success' | 'error', string> = {
  running: 'bg-blue-50 border-blue-100 text-blue-600',
  success: 'bg-green-50 border-green-100 text-green-600',
  error: 'bg-red-50 border-red-100 text-red-600',
}

const IMPORT_BAND_TEXTOS: Record<'running' | 'success' | 'error', string> = {
  running: 'Importando dados…',
  success: 'Importação concluída',
  error: 'Falha na importação',
}

function rotaAtiva(pathname: string | null, rotas: readonly string[]) {
  if (!pathname) return false
  return rotas.some(r => pathname === r || pathname.startsWith(r + '/'))
}

// Um item de módulo pode ter query string (ex: /financas?tab=despesas) — o
// usePathname() do Next nunca inclui query string, então comparamos só o path.
function itemAtivo(pathname: string | null, item: NavModuleItem) {
  if (!pathname) return false
  const path = item.href.split('?')[0]
  return pathname === path || pathname.startsWith(path + '/')
}

// Módulos com múltiplos itens que viram dropdown na barra desktop.
const DESKTOP_GROUPS: NavModuleKey[] = ['financas', 'cartao', 'listas', 'relatorios']

// Módulos exibidos no popover "Extras" do mobile (tudo que não tem botão próprio).
const MOBILE_EXTRAS_GROUPS: NavModuleKey[] = ['listas', 'relatorios', 'ia', 'configuracoes']

// Cache de sessão em nível de módulo — persiste entre navegações de rota
// e evita que cada mount do BottomNav faça um round-trip ao Supabase.
let _cachedSession: Session | null = null
let _sessionResolved = false

// ── Sub-menus mobile (popovers fixos, abrem pra cima) ──────────────────────────

function ModuleItemsList({
  items, onClose,
}: {
  items: readonly NavModuleItem[]
  onClose: () => void
}) {
  return (
    <>
      {items.map(({ href, label, Icon, iconColor, iconBg }, i) => (
        <Link
          key={href}
          href={href}
          onClick={onClose}
          prefetch={true}
          className={`flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800
                      active:bg-gray-100 dark:active:bg-gray-700 transition-colors duration-150
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400
                      ${i < items.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}
        >
          <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-4 h-4 ${iconColor}`} strokeWidth={1.8} />
          </div>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{label}</span>
        </Link>
      ))}
    </>
  )
}

function FinancasMenuPopover({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed bottom-[72px] left-3 z-[51] modal-center">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-float border border-gray-100 dark:border-gray-800 overflow-hidden w-56">
        <ModuleItemsList items={NAV_MODULES.financas.items} onClose={onClose} />
      </div>
    </div>
  )
}

function CartaoMenuPopover({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed bottom-[72px] right-14 z-[51] modal-center">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-float border border-gray-100 dark:border-gray-800 overflow-hidden w-56">
        <ModuleItemsList items={NAV_MODULES.cartao.items} onClose={onClose} />
      </div>
    </div>
  )
}

// Extras agrupa tudo que não tem botão próprio no bottom nav — Listas &
// Desejos, Relatórios, IA e Configurações — com cabeçalho por seção, no
// mesmo espírito do que existia isolado em app/extras/page.tsx.
function ExtrasMenuPopover({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed bottom-[72px] right-3 z-[51] modal-center">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-float border border-gray-100 dark:border-gray-800 overflow-hidden w-64 max-h-[70vh] overflow-y-auto">
        {MOBILE_EXTRAS_GROUPS.map((key, gi) => {
          const mod = NAV_MODULES[key]
          const items = mod.items.filter(i => !i.desktopOnly)
          if (items.length === 0) return null
          return (
            <div key={key} className={gi > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-4 pt-3 pb-1">
                {mod.label}
              </p>
              <ModuleItemsList items={items} onClose={onClose} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Sub-menu desktop (dropdown ancorado no item da barra, abre pra baixo) ──────

function DesktopModuleDropdown({ items, onClose }: { items: readonly NavModuleItem[]; onClose: () => void }) {
  return (
    <div className="absolute left-0 top-full mt-1.5 z-[51] w-56">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-float border border-gray-100 dark:border-gray-800 overflow-hidden">
        <ModuleItemsList items={items} onClose={onClose} />
      </div>
    </div>
  )
}

// ── Nav item offline (ícone maior, label visível, centralizado) ───────────────

function OfflineNavItem({
  href, label, icon: Icon, isActive,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  isActive: boolean
}) {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // O App Router do Next.js intercepta cliques em <a> da mesma origem via
    // listener global no document, convertendo-os em navegação RSC (client-side).
    // Em modo offline o RSC fetch falha silenciosamente. Usar window.location
    // escapa do interceptor e força request.mode==='navigate', permitindo que
    // o service worker sirva a página do cache HTML pré-cacheado.
    e.preventDefault()
    window.location.href = href
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className="flex flex-col items-center justify-center gap-1 flex-1 py-2
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                 focus-visible:ring-offset-1 rounded-xl"
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={`flex items-center justify-center w-14 h-9 rounded-2xl transition-colors duration-200
                        ${isActive ? 'bg-primary-100' : ''}`}>
        <Icon
          className={`transition-colors duration-200 w-[24px] h-[24px]
                      ${isActive ? 'text-primary-600' : 'text-gray-400'}`}
          strokeWidth={isActive ? 2.5 : 1.8}
        />
      </span>
      <span className={`text-[11px] font-semibold transition-colors duration-200 leading-none
                        ${isActive ? 'text-primary-600' : 'text-gray-500'}`}>
        {label}
      </span>
    </a>
  )
}

// ── Nav item button (Finanças / Cartão / Extras) ──────────────────────────────

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
                 focus-visible:ring-offset-1 rounded-xl"
    >
      <span className={`flex items-center justify-center w-10 h-6 rounded-full transition-colors duration-200
                        ${isActive ? 'bg-primary-100' : ''}`}>
        <Icon
          className={`transition-colors duration-200 w-[20px] h-[20px]
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

// ── Nav item link (Dashboard) ─────────────────────────────────────────────────

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
                 focus-visible:ring-offset-1 rounded-xl"
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={`flex items-center justify-center w-10 h-6 rounded-full transition-colors duration-200
                        ${isActive ? 'bg-primary-100' : ''}`}>
        <Icon
          className={`transition-colors duration-200 w-[20px] h-[20px]
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

// ── Nav item link desktop (Dashboard / IA / Config) ───────────────────────────

function DesktopNavLink({
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
      className="flex flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl flex-none
                 transition-colors duration-200
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon
        className={`w-4 h-4 transition-colors duration-200 ${isActive ? 'text-primary-600' : 'text-gray-500'}`}
        strokeWidth={isActive ? 2.5 : 1.8}
      />
      <span className={`text-[13px] font-medium leading-none transition-colors duration-200
                        ${isActive ? 'text-primary-600' : 'text-gray-600'}`}>
        {label}
      </span>
    </Link>
  )
}

// ── Botão de módulo desktop (abre dropdown) ───────────────────────────────────

function DesktopModuleButton({
  moduleKey, isActive, isOpen, onClick,
}: {
  moduleKey: NavModuleKey
  isActive: boolean
  isOpen: boolean
  onClick: () => void
}) {
  const mod = NAV_MODULES[moduleKey]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      className={`flex flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl flex-none
                  transition-colors duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1`}
    >
      <mod.Icon
        className={`w-4 h-4 transition-colors duration-200 ${isActive || isOpen ? 'text-primary-600' : 'text-gray-500'}`}
        strokeWidth={isActive || isOpen ? 2.5 : 1.8}
      />
      <span className={`text-[13px] font-medium leading-none transition-colors duration-200
                        ${isActive || isOpen ? 'text-primary-600' : 'text-gray-600'}`}>
        {mod.label}
      </span>
      <ChevronDown
        className={`w-3 h-3 transition-transform duration-200 ${isActive || isOpen ? 'text-primary-600' : 'text-gray-400'} ${isOpen ? 'rotate-180' : ''}`}
        strokeWidth={2}
      />
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default memo(function BottomNav() {
  const pathname = usePathname()
  const router   = useRouter()

  // Inicializa com a sessão em cache para evitar flash de "não logado"
  const [session, setSession] = useState<Session | null>(_cachedSession)
  const [isCheckingSession, setIsCheckingSession] = useState(!_sessionResolved)
  const [openMenu, setOpenMenu] = useState<'financas' | 'cartao' | 'extras' | null>(null)
  const [openDesktopMenu, setOpenDesktopMenu] = useState<NavModuleKey | null>(null)
  const [fabSheetOpen, setFabSheetOpen] = useState(false)
  const { categorizando } = useCategorizacao()
  const { execucaoManual: execucaoImportacao } = useImportacaoScript()
  const isOnline = useOnline()

  // Faixa de status da importação: só aparece para execuções de fato disparadas pelo
  // botão da tela de importação (execucaoManual) — nunca para as detectadas de forma
  // passiva ao carregar o app, que incluem o gatilho automático do Apps Script.
  const statusImportacao = execucaoImportacao?.status
  const importExecKey = `${statusImportacao ?? ''}|${execucaoImportacao?.iniciadoEm ?? ''}|${execucaoImportacao?.finalizadoEm ?? ''}`
  const [importDispensado, setImportDispensado] = useState(false)
  const [ultimaImportExecKey, setUltimaImportExecKey] = useState(importExecKey)
  if (importExecKey !== ultimaImportExecKey) {
    setUltimaImportExecKey(importExecKey)
    setImportDispensado(false)
  }

  useEffect(() => {
    if (statusImportacao !== 'success') return
    const id = setTimeout(() => setImportDispensado(true), IMPORT_BAND_AUTO_HIDE_MS)
    return () => clearTimeout(id)
  }, [statusImportacao, execucaoImportacao?.finalizadoEm])

  const mostrarFaixaImportacao =
    pathname !== '/importar' &&
    !importDispensado &&
    (statusImportacao === 'running' || statusImportacao === 'success' || statusImportacao === 'error')

  // Prefetch rotas dos sub-menus assim que o usuário os abre —
  // antecipa o RSC fetch antes do tap no item, tornando a navegação mais rápida.
  useEffect(() => {
    if (!isOnline || !openMenu) return
    if (openMenu === 'extras') {
      MOBILE_EXTRAS_GROUPS.forEach(key => {
        NAV_MODULES[key].items.forEach(item => {
          if (!item.desktopOnly) router.prefetch(item.href)
        })
      })
    } else {
      NAV_MODULES[openMenu].items.forEach(item => router.prefetch(item.href))
    }
  }, [openMenu, isOnline, router])

  useEffect(() => {
    if (!isOnline || !openDesktopMenu) return
    NAV_MODULES[openDesktopMenu].items.forEach(item => router.prefetch(item.href))
  }, [openDesktopMenu, isOnline, router])

  useEffect(() => {
    // Se AUTH_DISABLED ou sessão já resolvida, não faz round-trip ao Supabase
    if (AUTH_DISABLED) {
      setIsCheckingSession(false)
      return
    }

    if (_sessionResolved) {
      setSession(_cachedSession)
      setIsCheckingSession(false)
      return
    }

    let isMounted = true

    // onAuthStateChange dispara com INITIAL_SESSION imediatamente ao ler a sessão
    // do storage — elimina o round-trip separado de getSession().
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!isMounted) return
      _cachedSession = currentSession
      _sessionResolved = true
      setSession(currentSession)
      setIsCheckingSession(false)
    })

    // Fallback: agenda timeout só se onAuthStateChange ainda não resolveu
    // (ex: usuário deslogado). Evita agendamento desnecessário quando a sessão
    // já foi lida de forma síncrona do storage.
    let timeout: ReturnType<typeof setTimeout> | undefined
    if (!_sessionResolved) {
      timeout = setTimeout(() => {
        if (isMounted && !_sessionResolved) {
          _sessionResolved = true
          setIsCheckingSession(false)
        }
      }, 800)
    }

    return () => {
      isMounted = false
      authListener?.subscription?.unsubscribe()
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  // Fecha menus ao navegar para outra rota
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenMenu(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenDesktopMenu(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFabSheetOpen(false)
  }, [pathname])

  // Ao ficar offline: fecha menus abertos e redireciona para dashboard
  // se a rota atual não estiver disponível offline.
  // Usa window.location.href (não router.replace) para forçar navegação via SW cache —
  // router.replace faz fetch RSC que falha silenciosamente em modo offline.
  useEffect(() => {
    if (isOnline) return
    setOpenMenu(null)
    setOpenDesktopMenu(null)
    setFabSheetOpen(false)
    if (pathname && !ROTAS_OFFLINE.some(r => pathname === r || pathname.startsWith(r + '/'))) {
      window.location.href = '/dashboard'
    }
  }, [isOnline, pathname])

  const deveExibirMenu = pathname ? ROTAS_COM_MENU.some(r => pathname === r || pathname.startsWith(r + '/')) : false

  if (!deveExibirMenu) return null
  // Aguarda resolução da sessão para evitar flash de nav sem autenticação.
  // Offline: não exige sessão — o getSession() falha em rede, mas páginas
  // cacheadas funcionam normalmente e o usuário precisa do nav para navegar.
  // Por isso os dois checks abaixo só bloqueiam a renderização quando online:
  // isCheckingSession fica true de novo a cada cold start/reload (estado do
  // módulo é resetado), e teria escondido a barra em modo offline por até
  // 800ms (ou indefinidamente, se o reload de redirecionamento offline
  // interromper o efeito antes do timeout) mesmo com o usuário sem rede.
  if (!AUTH_DISABLED && isOnline && isCheckingSession) return null
  if (!AUTH_DISABLED && isOnline && !session) return null

  const isFinancasActive = rotaAtiva(pathname, ROTAS_FINANCAS)
  const isCartaoActive   = rotaAtiva(pathname, ROTAS_CARTAO)
  const isExtrasActive   = rotaAtiva(pathname, ROTAS_EXTRAS)

  return (
    <div
      data-bottom-nav="true"
      className="fixed bottom-0 left-0 right-0 z-[50]
                 lg:bottom-auto lg:top-0 lg:border-b lg:border-t-0"
    >
      {categorizando && isOnline && (
        <div className="flex items-center justify-center gap-1.5 bg-violet-50 border-b border-violet-100 py-1.5 text-xs text-violet-600 font-medium">
          <Sparkles className="w-3 h-3 animate-pulse" />
          Categorizando com IA…
        </div>
      )}

      {mostrarFaixaImportacao && statusImportacao && (
        <Link
          href="/importar"
          className={`flex items-center justify-center gap-1.5 border-b py-1.5 text-xs font-medium transition-colors ${IMPORT_BAND_ESTILOS[statusImportacao]}`}
        >
          {statusImportacao === 'running'
            ? <span className="w-3 h-3 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" />
            : <FileSpreadsheet className="w-3 h-3 shrink-0" aria-hidden="true" />}
          {IMPORT_BAND_TEXTOS[statusImportacao]}
          {statusImportacao !== 'running' && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImportDispensado(true) }}
              className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Dispensar aviso de importação"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </Link>
      )}

      {/* Indicador discreto de modo offline */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-1.5 bg-amber-50 border-b border-amber-100 py-1 text-xs text-amber-700 font-medium">
          <WifiOff className="w-3 h-3" />
          Modo Offline
        </div>
      )}

      <nav aria-label="Navegação principal">
        {/* ── Mobile: offline — Dashboard + FAB simplificado + Lista Mercado ── */}
        {!isOnline ? (
          <div className="flex lg:hidden justify-around items-center h-16 px-1">
            <OfflineNavItem
              href="/dashboard"
              label="Dashboard"
              icon={LayoutDashboard}
              isActive={pathname === '/dashboard'}
            />

            {/* FAB offline: abre diretamente a lista de mercado */}
            <button
              type="button"
              aria-label={fabSheetOpen ? 'Fechar menu' : 'Adicionar à lista'}
              aria-expanded={fabSheetOpen}
              onClick={() => setFabSheetOpen(p => !p)}
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

            <OfflineNavItem
              href="/lista-mercado"
              label="Lista Mercado"
              icon={ShoppingBasket}
              isActive={pathname ? pathname === '/lista-mercado' || pathname.startsWith('/lista-mercado/') : false}
            />
          </div>
        ) : (
          /* ── Mobile: online — 5 itens com FAB central ──────────────────── */
          <div className="flex lg:hidden justify-around items-center h-16 px-1">
            <MobileNavItem
              href="/dashboard"
              label="Dashboard"
              icon={LayoutDashboard}
              isActive={pathname === '/dashboard'}
            />

            <MobileMenuButton
              label="Finanças"
              icon={NAV_MODULES.financas.Icon}
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
              icon={NAV_MODULES.cartao.Icon}
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
        )}

        {/* ── Desktop: barra superior agrupada em módulos ────────────────────── */}
        <div className="hidden lg:flex justify-start items-center h-14 px-4 gap-1">
          <DesktopNavLink
            href="/dashboard"
            label="Dashboard"
            icon={LayoutDashboard}
            isActive={pathname === '/dashboard'}
          />

          {DESKTOP_GROUPS.map((key) => {
            const mod = NAV_MODULES[key]
            const isOpen = openDesktopMenu === key
            const isActive = mod.items.some(item => itemAtivo(pathname, item))
            return (
              <div key={key} className={`relative ${isOpen ? 'z-10' : ''}`}>
                <DesktopModuleButton
                  moduleKey={key}
                  isActive={isActive}
                  isOpen={isOpen}
                  onClick={() => setOpenDesktopMenu(p => p === key ? null : key)}
                />
                {isOpen && (
                  <DesktopModuleDropdown
                    items={mod.items}
                    onClose={() => setOpenDesktopMenu(null)}
                  />
                )}
              </div>
            )
          })}

          <DesktopNavLink
            href="/chat"
            label="IA"
            icon={NAV_MODULES.ia.Icon}
            isActive={pathname === '/chat'}
          />
          <DesktopNavLink
            href="/configuracoes"
            label="Config"
            icon={NAV_MODULES.configuracoes.Icon}
            isActive={pathname === '/configuracoes'}
          />
        </div>

        {/* ── Overlay para fechar dropdown desktop ao clicar fora ────────────── */}
        {openDesktopMenu && (
          <div
            className="hidden lg:block fixed inset-0 z-[49]"
            onClick={() => setOpenDesktopMenu(null)}
            aria-hidden="true"
          />
        )}

        {/* ── Menus flutuantes mobile via portal (apenas online) ─────────────── */}
        {isOnline && openMenu && (
          <ModalPortal>
            <div
              className="fixed inset-0 z-[49] modal-overlay"
              style={{ background: 'rgba(0,0,0,0.25)' }}
              onClick={() => setOpenMenu(null)}
              aria-hidden="true"
            />
            {openMenu === 'financas' && (
              <FinancasMenuPopover onClose={() => setOpenMenu(null)} />
            )}
            {openMenu === 'cartao' && (
              <CartaoMenuPopover onClose={() => setOpenMenu(null)} />
            )}
            {openMenu === 'extras' && (
              <ExtrasMenuPopover onClose={() => setOpenMenu(null)} />
            )}
          </ModalPortal>
        )}

        {/* ── FAB Quick Launch Sheet (online: completo, offline: só mercado) ── */}
        {fabSheetOpen && (
          <FabQuickLaunchSheet onClose={() => setFabSheetOpen(false)} />
        )}
      </nav>
    </div>
  )
})
