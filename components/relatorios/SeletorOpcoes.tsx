'use client'

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
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex gap-1 bg-white rounded-2xl shadow-card border border-gray-100 p-1 overflow-x-auto"
    >
      {opcoes.map(opcao => {
        const ativo = opcao.valor === valor
        return (
          <button
            key={String(opcao.valor)}
            type="button"
            onClick={() => onChange(opcao.valor)}
            aria-pressed={ativo}
            className={`flex-1 whitespace-nowrap px-3 py-2 rounded-xl text-xs font-semibold
                        transition-all duration-150 ease-spring tap-scale
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300
                        ${ativo
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {opcao.label}
          </button>
        )
      })}
    </div>
  )
}
