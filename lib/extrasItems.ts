import type { LucideIcon } from 'lucide-react'
import { Sparkles, Heart, ShoppingBasket, Crown, SlidersHorizontal, Activity, FileText } from 'lucide-react'

export interface ExtraItem {
  href: string
  label: string
  description: string
  Icon: LucideIcon
  iconBg: string
  iconColor: string
  badge?: string
  badgeColor?: string
  quickAccess?: boolean
  popoverBg: string
  popoverColor: string
}

export interface ExtraGrupo {
  titulo: string
  items: ExtraItem[]
}

export const EXTRAS_GRUPOS: ExtraGrupo[] = [
  {
    titulo: 'Inteligência',
    items: [
      {
        href: '/chat',
        label: 'Assistente IA',
        description: 'Pergunte sobre suas finanças com base nos seus dados reais',
        Icon: Sparkles,
        iconBg: 'bg-gradient-to-br from-violet-500 to-indigo-600',
        iconColor: 'text-white',
        badge: 'IA',
        badgeColor: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
        quickAccess: true,
        popoverBg: 'bg-primary-50',
        popoverColor: 'text-primary-600',
      },
    ],
  },
  {
    titulo: 'Listas & Desejos',
    items: [
      {
        href: '/wishlist',
        label: 'Wishlist',
        description: 'Itens que vocês querem comprar, com prioridade e preço estimado',
        Icon: Heart,
        iconBg: 'bg-pink-100',
        iconColor: 'text-pink-500',
        quickAccess: true,
        popoverBg: 'bg-pink-50',
        popoverColor: 'text-pink-500 dark:text-pink-400',
      },
      {
        href: '/lista-mercado',
        label: 'Lista de Mercado',
        description: 'Lista colaborativa com sync em tempo real e histórico de compras',
        Icon: ShoppingBasket,
        iconBg: 'bg-emerald-100',
        iconColor: 'text-emerald-600',
        quickAccess: true,
        popoverBg: 'bg-green-50',
        popoverColor: 'text-green-600',
      },
      {
        href: '/listas-compras',
        label: 'Listas da Princesa',
        description: 'Crie listas por nome, controle gastos previstos e realizados',
        Icon: Crown,
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-600',
        quickAccess: true,
        popoverBg: 'bg-amber-50',
        popoverColor: 'text-amber-600',
      },
    ],
  },
  {
    titulo: 'Relatórios',
    items: [
      {
        href: '/relatorios',
        label: 'Relatório Mensal',
        description: 'Receitas, despesas, compras e investimentos do mês em PDF ou CSV',
        Icon: FileText,
        iconBg: 'bg-sky-100',
        iconColor: 'text-sky-600',
        quickAccess: true,
        popoverBg: 'bg-sky-50',
        popoverColor: 'text-sky-600',
      },
    ],
  },
  {
    titulo: 'Configurações',
    items: [
      {
        href: '/configuracoes',
        label: 'Configurações',
        description: 'Cartões, faturas, categorias e preferências',
        Icon: SlidersHorizontal,
        iconBg: 'bg-gray-100',
        iconColor: 'text-gray-600',
        quickAccess: true,
        popoverBg: 'bg-gray-100',
        popoverColor: 'text-gray-600',
      },
      {
        href: '/configuracoes?tab=atividades',
        label: 'Atividades',
        description: 'Histórico completo de ações realizadas no app',
        Icon: Activity,
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-600',
        popoverBg: 'bg-amber-50',
        popoverColor: 'text-amber-600',
      },
    ],
  },
]

export const EXTRAS_QUICK_ACCESS: ExtraItem[] =
  EXTRAS_GRUPOS.flatMap(g => g.items).filter(i => i.quickAccess)
