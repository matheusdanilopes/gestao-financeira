'use client'

import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { formatBRL } from '@/lib/format'

/** Texto exibido no lugar de um valor quando o "olho" está fechado. */
export const MASCARA_VALOR = 'R$ ••••'

/**
 * Estado do "olho" do Dashboard: quando true, os valores em texto viram
 * MASCARA_VALOR e os gráficos ficam borrados. O padrão é false, então os
 * componentes compartilhados com outras telas continuam mostrando os valores.
 */
const ValoresOcultosContext = createContext(false)

export function ValoresOcultosProvider({ ocultar, children }: { ocultar: boolean; children: ReactNode }) {
  return <ValoresOcultosContext.Provider value={ocultar}>{children}</ValoresOcultosContext.Provider>
}

export function useValoresOcultos(): boolean {
  return useContext(ValoresOcultosContext)
}

/** formatBRL que respeita o olho: devolve MASCARA_VALOR quando os valores estão ocultos. */
export function useFormatarValor(): (valor: number) => string {
  const ocultar = useValoresOcultos()
  return useCallback((valor: number) => (ocultar ? MASCARA_VALOR : formatBRL(valor)), [ocultar])
}

/**
 * Borra o conteúdo inteiro (gráficos) quando os valores estão ocultos. Também
 * bloqueia toque/hover, para que tooltips e drawers não revelem os números.
 */
export function GraficoOcultavel({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ocultar = useValoresOcultos()
  return (
    <div
      className={`transition-[filter] duration-200 ${ocultar ? 'blur-md pointer-events-none select-none' : ''} ${className}`}
      aria-hidden={ocultar || undefined}
    >
      {children}
    </div>
  )
}
