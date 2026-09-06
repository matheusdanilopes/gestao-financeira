'use client'

import { formatBRL } from '@/lib/format'
import { formatarPercentual } from '@/lib/relatoriosFormat'

export interface ItemDistribuicao {
  label: string
  valor: number
  /** Contexto à direita do valor — "12 compras", "3 itens". */
  detalhe?: string
}

const CORES = [
  'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
  'bg-fuchsia-500', 'bg-lime-500',
]

/**
 * Ranking horizontal com barra proporcional — responde "para onde foi o
 * dinheiro" sem exigir que o usuário leia uma tabela inteira.
 */
export default function BarrasDistribuicao({
  itens,
  limite = 8,
  vazio = 'Sem dados para o período.',
}: {
  itens: ItemDistribuicao[]
  limite?: number
  vazio?: string
}) {
  const ordenados = [...itens].filter(i => i.valor > 0).sort((a, b) => b.valor - a.valor)
  if (ordenados.length === 0) return <p className="text-xs text-gray-400 py-2">{vazio}</p>

  const total = ordenados.reduce((acc, i) => acc + i.valor, 0)
  const maior = ordenados[0].valor
  const visiveis = ordenados.slice(0, limite)
  const resto = ordenados.slice(limite)
  const linhas = resto.length > 0
    ? [...visiveis, { label: `Outros (${resto.length})`, valor: resto.reduce((a, i) => a + i.valor, 0) }]
    : visiveis

  return (
    <ul className="space-y-2">
      {linhas.map((item, idx) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-gray-700 truncate">{item.label}</span>
            <span className="text-xs font-bold text-gray-900 num shrink-0">
              {formatBRL(item.valor)}
              <span className="ml-1.5 font-normal text-gray-400">
                {formatarPercentual((item.valor / total) * 100, 0)}
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${CORES[idx % CORES.length]} transition-[width] duration-500`}
              style={{ width: `${Math.max(2, (item.valor / maior) * 100)}%` }}
            />
          </div>
          {'detalhe' in item && item.detalhe && (
            <p className="text-[11px] text-gray-400">{item.detalhe}</p>
          )}
        </li>
      ))}
    </ul>
  )
}
