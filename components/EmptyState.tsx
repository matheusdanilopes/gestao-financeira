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
  iconClassName = 'text-gray-400 dark:text-gray-500',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 gap-4 text-center page-enter">
      {/* Moldura do ícone com aro interno suave e leve gradiente — leitura
          premium e consistente entre telas para o estado vazio. */}
      <div
        className="w-14 h-14 md:w-16 md:h-16 rounded-2xl flex items-center justify-center
                   bg-gradient-to-b from-gray-50 to-gray-100/70
                   dark:from-white/[0.06] dark:to-white/[0.02]
                   ring-1 ring-inset ring-gray-200/70 dark:ring-white/10
                   shadow-card"
      >
        <Icon className={`w-6 h-6 md:w-7 md:h-7 ${iconClassName}`} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm md:text-base font-semibold text-gray-700 dark:text-gray-200 text-balance">
          {title}
        </p>
        {description && (
          <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-[240px] md:max-w-sm mx-auto text-balance">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
