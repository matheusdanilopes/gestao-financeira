'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { RELATORIOS_DISPONIVEIS } from '@/lib/relatoriosItems'

export default function RelatoriosPage() {
  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Relatórios</h1>
      </div>

      <div className="page-content mt-4 space-y-2">
        {RELATORIOS_DISPONIVEIS.map(({ href, titulo, descricao, Icon, iconBg, iconColor }) => (
          <Link
            key={href}
            href={href}
            className="card-3d flex items-center gap-4 bg-white rounded-3xl shadow-card p-5
                       border border-gray-100 transition-colors
                       hover:border-gray-200 hover:shadow-card-hover
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <div className={`w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
              <Icon className={`w-6 h-6 ${iconColor}`} strokeWidth={1.8} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm tracking-tight">{titulo}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-snug">{descricao}</p>
            </div>

            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
