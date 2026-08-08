/**
 * Skeleton genérico usado pelos loading.tsx de cada rota — preenche a área de
 * conteúdo (header/bottom nav do ClientShell continuam montados) enquanto o
 * chunk da rota carrega, evitando o "frame em branco" durante a troca de tela.
 */
export default function RouteLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f172a] page-bottom-safe page-enter">
      <div className="pt-3 pb-3 px-4 md:px-6 lg:px-8 space-y-3">
        <div className="skeleton h-6 w-40 rounded-full" />
        <div className="skeleton h-11 w-full rounded-2xl" />
      </div>
      <div className="page-content space-y-3">
        <div className="skeleton h-24 w-full rounded-3xl" />
        <div className="skeleton h-24 w-full rounded-3xl" />
        <div className="skeleton h-40 w-full rounded-3xl" />
      </div>
    </div>
  )
}
