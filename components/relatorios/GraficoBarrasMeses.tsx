'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format'

export interface PontoMes {
  label: string
  valor: number
  /** Realça a barra — usado para o mês selecionado ou o mês corrente. */
  destaque?: boolean
  /** Barra tracejada, para projeções (valores ainda não realizados). */
  projetado?: boolean
}

/**
 * Série mensal em barras, sem Chart.js.
 *
 * A tela de relatórios é consultada bastante no celular e um gráfico do
 * Chart.js aqui custaria ~70 kB e um canvas por seção. Este componente é
 * HTML puro: cada barra é um botão, então dá para tocar e ler o valor —
 * hover não existe em toque.
 */
export default function GraficoBarrasMeses({
  pontos,
  media,
  altura = 96,
}: {
  pontos: PontoMes[]
  /** Linha de referência (média do período). */
  media?: number
  altura?: number
}) {
  const [selecionado, setSelecionado] = useState<number | null>(null)

  if (pontos.length === 0) return null

  const maior = Math.max(...pontos.map(p => p.valor), 1)
  const idxAtivo = selecionado ?? pontos.findIndex(p => p.destaque)
  const ativo = idxAtivo >= 0 ? pontos[idxAtivo] : null

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 min-h-[20px]">
        <span className="text-[11px] text-gray-400">
          {ativo ? ativo.label : 'Toque em uma barra'}
        </span>
        <span className="text-sm font-bold text-gray-900 num">
          {ativo ? formatBRL(ativo.valor) : ''}
        </span>
      </div>

      <div className="relative flex items-end gap-1" style={{ height: altura }}>
        {media !== undefined && media > 0 && media <= maior && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-gray-300 pointer-events-none"
            style={{ bottom: `${(media / maior) * 100}%` }}
            aria-hidden="true"
          />
        )}
        {pontos.map((p, idx) => {
          const ativoAqui = idx === idxAtivo
          return (
            <button
              key={`${p.label}-${idx}`}
              type="button"
              onClick={() => setSelecionado(idx === selecionado ? null : idx)}
              title={`${p.label}: ${formatBRL(p.valor)}`}
              aria-label={`${p.label}: ${formatBRL(p.valor)}`}
              className="flex-1 h-full flex items-end rounded-t-md group focus-visible:outline-none"
            >
              <span
                className={`w-full rounded-t-md transition-all duration-300
                            ${p.projetado
                              ? 'bg-violet-200 group-hover:bg-violet-300'
                              : ativoAqui
                                ? 'bg-primary-500'
                                : 'bg-primary-200 group-hover:bg-primary-300'}`}
                style={{ height: `${Math.max(3, (p.valor / maior) * 100)}%` }}
              />
            </button>
          )
        })}
      </div>

      <div className="flex gap-1">
        {pontos.map((p, idx) => (
          <span
            key={`${p.label}-lbl-${idx}`}
            className={`flex-1 text-center text-[9px] leading-tight truncate
                        ${idx === idxAtivo ? 'text-gray-700 font-semibold' : 'text-gray-400'}`}
          >
            {p.label.replace(/\/\d{4}$/, '')}
          </span>
        ))}
      </div>

      {media !== undefined && media > 0 && (
        <p className="text-[11px] text-gray-400">
          Linha tracejada: média do período ({formatBRL(media)}).
        </p>
      )}
    </div>
  )
}
