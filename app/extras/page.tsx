'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { EXTRAS_GRUPOS } from '@/lib/extrasItems'

export default function ExtrasPage() {
  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Extras</h1>
      </div>

      <div className="page-content mt-4 space-y-6">
        {EXTRAS_GRUPOS.map(({ titulo, items }) => (
          <div key={titulo}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">{titulo}</p>
            <div className="space-y-2">
              {items.map(({ href, label, description, iconBg, iconColor, Icon, badge, badgeColor }) => (
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
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-sm tracking-tight">{label}</p>
                      {badge && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badgeColor} leading-none`}>
                          {badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{description}</p>
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
