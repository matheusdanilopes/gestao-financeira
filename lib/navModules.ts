import type { LucideIcon } from 'lucide-react'
import {
  Wallet, CreditCard, ListChecks, FileText, Sparkles, SlidersHorizontal,
  Receipt, TrendingUp, PiggyBank,
  ShoppingCart, RepeatIcon, Layers,
  Heart, ShoppingBasket, Crown,
  BarChart3,
} from 'lucide-react'

export interface NavModuleItem {
  href: string
  label: string
  Icon: LucideIcon
  iconColor: string
  iconBg: string
  /** Só aparece no dropdown desktop — ex: Analytics, pensado pra tela larga. */
  desktopOnly?: boolean
}

export interface NavModule {
  key: string
  label: string
  Icon: LucideIcon
  items: NavModuleItem[]
}

const financas: NavModule = {
  key: 'financas',
  label: 'Finanças',
  Icon: Wallet,
  items: [
    { href: '/financas?tab=despesas', label: 'Despesas', Icon: Receipt, iconColor: 'text-red-500', iconBg: 'bg-red-50' },
    { href: '/financas?tab=receitas', label: 'Receitas', Icon: TrendingUp, iconColor: 'text-green-600', iconBg: 'bg-green-50' },
    { href: '/financas?tab=investimentos', label: 'Investimentos', Icon: PiggyBank, iconColor: 'text-blue-600', iconBg: 'bg-blue-50' },
  ],
}

const cartao: NavModule = {
  key: 'cartao',
  label: 'Cartão',
  Icon: CreditCard,
  items: [
    { href: '/compras', label: 'Compras', Icon: ShoppingCart, iconColor: 'text-orange-500 dark:text-orange-400', iconBg: 'bg-orange-50 dark:bg-orange-900/20' },
    { href: '/assinaturas', label: 'Assinaturas', Icon: RepeatIcon, iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-50 dark:bg-indigo-900/20' },
    { href: '/parcelamentos', label: 'Parcelamentos', Icon: Layers, iconColor: 'text-teal-600 dark:text-teal-400', iconBg: 'bg-teal-50 dark:bg-teal-900/20' },
  ],
}

const listas: NavModule = {
  key: 'listas',
  label: 'Listas & Desejos',
  Icon: ListChecks,
  items: [
    { href: '/wishlist', label: 'Wishlist', Icon: Heart, iconColor: 'text-pink-500 dark:text-pink-400', iconBg: 'bg-pink-50 dark:bg-pink-900/20' },
    { href: '/lista-mercado', label: 'Mercado', Icon: ShoppingBasket, iconColor: 'text-green-600 dark:text-green-400', iconBg: 'bg-green-50 dark:bg-green-900/20' },
    { href: '/listas-compras', label: 'Princesa', Icon: Crown, iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-50 dark:bg-amber-900/20' },
  ],
}

const relatorios: NavModule = {
  key: 'relatorios',
  label: 'Relatórios',
  Icon: FileText,
  items: [
    { href: '/relatorios', label: 'Relatórios', Icon: FileText, iconColor: 'text-sky-600 dark:text-sky-400', iconBg: 'bg-sky-50 dark:bg-sky-900/20' },
    { href: '/analytics', label: 'Analytics', Icon: BarChart3, iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-50 dark:bg-violet-900/20', desktopOnly: true },
  ],
}

const ia: NavModule = {
  key: 'ia',
  label: 'IA',
  Icon: Sparkles,
  items: [
    { href: '/chat', label: 'Assistente IA', Icon: Sparkles, iconColor: 'text-primary-600', iconBg: 'bg-primary-50' },
  ],
}

const configuracoes: NavModule = {
  key: 'configuracoes',
  label: 'Configurações',
  Icon: SlidersHorizontal,
  items: [
    { href: '/configuracoes', label: 'Configurações', Icon: SlidersHorizontal, iconColor: 'text-gray-600', iconBg: 'bg-gray-100' },
  ],
}

// Catálogo único de módulos de navegação, consumido tanto pelos popovers do
// bottom nav mobile quanto pelos dropdowns da barra superior desktop — evita
// que os dois divergam com o tempo.
export const NAV_MODULES = { financas, cartao, listas, relatorios, ia, configuracoes }

export type NavModuleKey = keyof typeof NAV_MODULES
