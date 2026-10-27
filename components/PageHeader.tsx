'use client'

import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import NotificacoesBell from '@/components/NotificacoesBell'
import DataStatusIndicator from '@/components/DataStatusIndicator'
import { useRefreshContext } from '@/components/RefreshProvider'
import { InfoPopover } from '@/components/InfoPopover'

// Controles reaproveitados dentro e fora do topo (ex: SeletorOpcoes) leem
// isto para trocar para a versão clara sobre o índigo.
const DentroDoTopoContext = createContext(false)
export function useDentroDoTopo() {
  return useContext(DentroDoTopoContext)
}

interface PageHeaderProps {
  title: ReactNode
  /** Linha menor abaixo do título (contagens, última importação…) */
  subtitle?: ReactNode
  /** Texto do "i" ao lado do título */
  info?: string
  /** Ícone num círculo translúcido à esquerda do título */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  onBack?: () => void
  backLabel?: string
  /** Botões à direita do título — use os estilos de PageHeader.actionClass */
  actions?: ReactNode
  /** Mostra o sino de notificações */
  bell?: boolean
  /** Mostra o indicador "Atualizado há…" da tela (useGlobalSync) */
  sync?: boolean
  /** O pai tem padding lateral (.page-content): o topo estica até a borda */
  bleed?: boolean
  /** Controles fixos sob o título (seletor de mês, busca, campo de adicionar) */
  children?: ReactNode
}

/**
 * Topo índigo das telas internas — mesma linguagem do Dashboard. Fica fixo no
 * scroll e termina numa "aba" arredondada da cor do fundo, dando o efeito do
 * conteúdo numa folha sobreposta ao topo. No desktop vira um card arredondado.
 */
export default function PageHeader({
  title, subtitle, info, icon: Icon, onBack, backLabel = 'Voltar', actions, bell, sync, bleed, children,
}: PageHeaderProps) {
  const { syncState } = useRefreshContext()

  return (
    <header data-page-header className={`sticky top-0 lg:top-14 z-[10] lg:pt-4 lg:mb-4 bg-gray-50 ${bleed ? '-mx-4 md:-mx-6 lg:mx-0' : 'lg:mx-8'}`}>
      <div className="bg-primary-600 dark:bg-primary-900 text-white px-4 md:px-6 lg:px-6
                      pt-[calc(0.75rem+var(--safe-top))] pb-4 lg:pt-4 lg:rounded-3xl">
        <div className="flex items-center gap-3 min-h-[44px]">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className={PAGE_HEADER_ACTION}
              aria-label={backLabel}
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.2} />
            </button>
          )}
          {Icon && (
            <span className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0" aria-hidden="true">
              <Icon className="w-5 h-5" strokeWidth={2} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-tight flex items-center gap-1.5 min-w-0">
              <span className="truncate">{title}</span>
              {info && <InfoPopover tone="inverse" texto={info} />}
            </h1>
            {subtitle && <div className="text-xs text-white/75 mt-0.5 leading-snug">{subtitle}</div>}
          </div>
          {(actions || bell || (sync && syncState)) && (
            <div className="flex items-center gap-2 shrink-0">
              {sync && syncState && (
                <DataStatusIndicator
                  status={syncState.status}
                  lastUpdated={syncState.lastUpdated}
                  onRefresh={syncState.refetch}
                />
              )}
              {actions}
              {bell && <NotificacoesBell tone="inverse" />}
            </div>
          )}
        </div>
        {children && (
          <DentroDoTopoContext.Provider value={true}>
            <div className="mt-3 space-y-3">{children}</div>
          </DentroDoTopoContext.Provider>
        )}
      </div>
      {/* Aba arredondada: início da "folha" de conteúdo (só no mobile) */}
      <div className="h-5 bg-primary-600 dark:bg-primary-900 lg:hidden" aria-hidden="true">
        <div className="h-full bg-gray-50 rounded-t-3xl" />
      </div>
    </header>
  )
}

/** Botão redondo translúcido para `actions` e voltar */
export const PAGE_HEADER_ACTION =
  'w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center shrink-0 ' +
  'tap-scale transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50'

/** Botão em pílula translúcida com texto, para `actions` */
export const PAGE_HEADER_PILL =
  'h-10 px-3.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 ' +
  'tap-scale transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50'
