/**
 * Skeleton genérico usado pelos loading.tsx de cada rota — preenche a área de
 * conteúdo (bottom nav do ClientShell continua montada) enquanto o chunk da
 * rota carrega, evitando o "frame em branco" durante a troca de tela. Imita o
 * PageHeader (topo índigo + aba arredondada) para nada pular quando a tela chega.
 */
export default function RouteLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f172a] page-bottom-safe page-enter" aria-hidden="true">
      <div className="route-progress" />
      <div className="lg:pt-4 lg:mx-8">
        <div className="bg-primary-600 dark:bg-primary-900 px-4 md:px-6 pt-[calc(0.75rem+var(--safe-top))] pb-4 lg:pt-4 lg:rounded-3xl space-y-3">
          <div className="flex items-center gap-3 min-h-[44px]">
            <div className="skeleton-inverse h-6 w-40 rounded-full" />
          </div>
          <div className="skeleton-inverse h-11 w-52 rounded-full" />
        </div>
        <div className="h-5 bg-primary-600 dark:bg-primary-900 lg:hidden">
          <div className="h-full bg-gray-50 dark:bg-[#0f172a] rounded-t-3xl" />
        </div>
      </div>
      <div className="page-content space-y-3 lg:pt-4">
        <div className="skeleton h-24 w-full rounded-3xl" />
        <div className="skeleton h-24 w-full rounded-3xl" />
        <div className="skeleton h-40 w-full rounded-3xl" />
      </div>
    </div>
  )
}
