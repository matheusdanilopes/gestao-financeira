'use client'

import { useDentroDoTopo } from '@/components/PageHeader'

export interface OpcaoSeletor<T extends string | number> {
  valor: T
  label: string
}

/**
 * Controle segmentado usado nos filtros dos relatórios (janela de meses,
 * fonte dos dados, responsável). Fica no cabeçalho fixo, então precisa
 * caber em uma linha no celular — daí o scroll horizontal.
 */
export default function SeletorOpcoes<T extends string | number>({
  opcoes, valor, onChange, ariaLabel,
}: {
  opcoes: OpcaoSeletor<T>[]
  valor: T
  onChange: (valor: T) => void
  ariaLabel: string
}) {
  const inverso = useDentroDoTopo()
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex gap-1 rounded-full p-1 overflow-x-auto scrollbar-hide ${inverso ? 'bg-white/15' : 'bg-gray-100'}`}
    >
      {opcoes.map(opcao => {
        const ativo = opcao.valor === valor
        return (
          <button
            key={String(opcao.valor)}
            type="button"
            onClick={() => onChange(opcao.valor)}
            aria-pressed={ativo}
            className={`flex-1 whitespace-nowrap px-3 py-2 rounded-full text-xs font-semibold
                        transition-all duration-150 ease-smooth tap-scale
                        focus-visible:outline-none focus-visible:ring-2
                        ${inverso ? 'focus-visible:ring-white/60' : 'focus-visible:ring-primary-300'}
                        ${ativo
                          ? 'bg-white text-gray-900 shadow-sm'
                          : inverso
                            ? 'text-white/80 hover:text-white hover:bg-white/10'
                            : 'text-gray-500 hover:text-gray-700'}`}
          >
            {opcao.label}
          </button>
        )
      })}
    </div>
  )
}
