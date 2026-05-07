'use client'

import dynamic from 'next/dynamic'

const AnalyticsDesktop = dynamic(
  () => import('@/components/AnalyticsDesktop'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-[#0f172a]">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    ),
  }
)

export default function AnalyticsPage() {
  return <AnalyticsDesktop />
}
