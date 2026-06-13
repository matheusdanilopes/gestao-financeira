'use client'

import dynamic from 'next/dynamic'

const AnalyticsDesktop = dynamic(
  () => import('@/components/AnalyticsDesktop'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-[#0f172a]">
        <div className="flex flex-col items-center gap-4">
          {/* Skeleton que imita o layout bento */}
          <div className="grid grid-cols-3 gap-4 w-[860px] max-w-full px-6">
            <div className="col-span-2 skeleton h-80 rounded-3xl" />
            <div className="col-span-1 skeleton h-80 rounded-3xl" />
            <div className="col-span-1 skeleton h-64 rounded-3xl" />
            <div className="col-span-2 skeleton h-64 rounded-3xl" />
          </div>
        </div>
      </div>
    ),
  }
)

export default function AnalyticsPage() {
  return <AnalyticsDesktop />
}
