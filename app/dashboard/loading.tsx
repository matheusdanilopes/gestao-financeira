/**
 * Skeleton com o mesmo formato do Dashboard (topo índigo + folha sobreposta +
 * atalhos + cards) — quando o conteúdo chega, nada "pula" de lugar.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe" aria-hidden="true">
      <div className="route-progress" />
      <div className="bg-primary-600 dark:bg-primary-900 px-5 md:px-6 lg:px-8
                      pt-[calc(1rem+var(--safe-top))] pb-11 lg:pt-6 lg:pb-8 lg:mt-4 lg:mx-8 lg:rounded-3xl">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="skeleton-inverse h-3 w-16 rounded-full" />
            <div className="skeleton-inverse h-5 w-40 rounded-full" />
          </div>
          <div className="flex gap-2">
            <div className="skeleton-inverse w-11 h-11 rounded-full" />
            <div className="skeleton-inverse w-11 h-11 rounded-full" />
          </div>
        </div>
        <div className="skeleton-inverse mt-4 h-11 w-52 rounded-full" />
        <div className="mt-5 space-y-3">
          <div className="skeleton-inverse h-4 w-36 rounded-full" />
          <div className="skeleton-inverse h-10 w-56" />
          <div className="skeleton-inverse h-1.5 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div className="skeleton-inverse h-14 rounded-2xl" />
            <div className="skeleton-inverse h-14 rounded-2xl" />
          </div>
        </div>
      </div>

      <div className="-mt-6 lg:mt-0 rounded-t-3xl lg:rounded-none bg-gray-50 pt-5 lg:pt-6">
        <div className="page-content space-y-4">
          <div className="skeleton h-10 w-full lg:max-w-xs rounded-full mb-5" />
          <div className="grid grid-cols-5 gap-1 lg:flex lg:gap-6">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="skeleton w-[52px] h-[52px] min-[380px]:w-14 min-[380px]:h-14 rounded-full" />
                <div className="skeleton h-2.5 w-11 rounded-full" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="skeleton h-16 rounded-2xl" />
            <div className="skeleton h-16 rounded-2xl" />
            <div className="skeleton h-16 rounded-2xl" />
          </div>
          <div className="skeleton h-64 w-full rounded-3xl" />
        </div>
      </div>
    </div>
  )
}
