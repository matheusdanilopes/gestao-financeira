'use client'

import Link from 'next/link'
import { MessageCircle, SlidersHorizontal, ChevronRight } from 'lucide-react'

const items = [
  {
    href:        '/chat',
    label:       'Assistente IA',
    description: 'Pergunte sobre suas finanças',
    iconBg:      'bg-primary-50 dark:bg-primary-900/30',
    iconColor:   'text-primary-600',
    Icon:        MessageCircle,
  },
  {
    href:        '/configuracoes',
    label:       'Configurações',
    description: 'Cartões, faturas e preferências',
    iconBg:      'bg-gray-100',
    iconColor:   'text-gray-600',
    Icon:        SlidersHorizontal,
  },
]

export default function ExtrasPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900">Extras</h1>
      </div>

      <div className="page-content mt-4 space-y-3">
        {items.map(({ href, label, description, iconBg, iconColor, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 bg-white rounded-3xl shadow-card p-5
                       border border-gray-100 active:scale-[0.99] transition-transform
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <div className={`w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-6 h-6 ${iconColor}`} strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
