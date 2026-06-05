import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  iconClassName?: string
  iconBg?: string
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  iconClassName = 'text-gray-400',
  iconBg,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 gap-4 text-center">
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
          iconBg ?? 'bg-gray-50 border border-gray-100'
        }`}
      >
        <Icon className={`w-7 h-7 ${iconClassName}`} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5 max-w-[220px]">
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        {description && (
          <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
