import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  iconClassName?: string
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  iconClassName = 'text-gray-300',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 gap-3 text-center">
      <div className="w-10 h-10 md:w-14 md:h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center">
        <Icon className={`w-5 h-5 md:w-7 md:h-7 ${iconClassName}`} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-500">{title}</p>
        {description && (
          <p className="text-xs text-gray-400 max-w-[200px] md:max-w-xs">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
