'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { PieChart } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'

const GraficoCategoriasDespesas = dynamic(
  () => import('@/components/GraficoCategoriasDespesas'),
  { ssr: false, loading: () => <div className="h-64 skeleton rounded-2xl" /> },
)
const CategoryTreemap = dynamic(
  () => import('@/components/CategoryTreemap'),
  { ssr: false, loading: () => <div className="h-64 skeleton rounded-2xl" /> },
)
const LimitesCategorias = dynamic(
  () => import('@/components/LimitesCategorias'),
  { ssr: false, loading: () => <div className="h-64 skeleton rounded-2xl" /> },
)

type AbaCategoria = 'planejado' | 'fatura' | 'limites'

const ABAS: { id: AbaCategoria; label: string; ajuda: string }[] = [
  {
    id: 'planejado',
    label: 'Planejado',
    ajuda: 'Distribuição das despesas do planejamento do mês por categoria: barra cinza é o previsto, barra colorida é o que já foi pago. Toque numa coluna para ver os lançamentos que compõem a categoria.',
  },
  {
    id: 'fatura',
    label: 'Fatura',
    ajuda: 'Compras efetivamente importadas da fatura do mês, agrupadas por categoria. Diferente da aba Planejado, que parte do planejamento e não das compras do cartão.',
  },
  {
    id: 'limites',
    label: 'Limites',
    ajuda: 'Quanto já foi gasto na fatura em cada categoria com limite configurado nas Configurações.',
  },
]

interface Props {
  mesAtual: Date
  cartao1Nome?: string
  cartao2Nome?: string
  /** false pausa o polling dos gráficos internos (ex.: aba do Dashboard oculta) */
  ativo?: boolean
  onCategoriaClicada?: (categoria: string, valor: number, itens: Record<string, unknown>[]) => void
}

/**
 * Reúne as três leituras de categoria que antes ocupavam três cards seguidos na
 * aba de Gráficos — planejamento, fatura importada e limites configurados. Eram
 * fontes de dados diferentes apresentadas lado a lado sem nada explicando a
 * diferença, o que fazia os totais parecerem divergentes.
 *
 * Só a aba selecionada é montada: as outras não disparam fetch enquanto não
 * forem abertas, e permanecem montadas depois (cada gráfico tem cache interno).
 */
export default function PainelCategorias({
  mesAtual,
  cartao1Nome,
  cartao2Nome,
  ativo = true,
  onCategoriaClicada,
}: Props) {
  const [aba, setAba] = useState<AbaCategoria>('planejado')
  const [jaAbertas, setJaAbertas] = useState<Set<AbaCategoria>>(new Set(['planejado']))

  const abrir = (id: AbaCategoria) => {
    setAba(id)
    setJaAbertas(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  const ajudaAtual = ABAS.find(a => a.id === aba)?.ajuda ?? ''

  return (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <PieChart className="w-4 h-4 text-indigo-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
          Categorias
          <InfoPopover texto={ajudaAtual} />
        </h2>

        <div className="inline-flex items-center bg-gray-100 rounded-full p-[2px] gap-[1px] ml-auto">
          {ABAS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => abrir(id)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all duration-200 ${
                aba === id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {jaAbertas.has('planejado') && (
        <div className={aba === 'planejado' ? '' : 'hidden'}>
          <p className="text-xs text-gray-400 mb-4">Previsto x pago · Toque numa coluna para detalhes</p>
          <GraficoCategoriasDespesas
            mesAtual={mesAtual}
            ativo={ativo && aba === 'planejado'}
            onCategoriaClicada={onCategoriaClicada}
          />
        </div>
      )}

      {jaAbertas.has('fatura') && (
        <div className={aba === 'fatura' ? '' : 'hidden'}>
          <CategoryTreemap mesAtual={mesAtual} embutido />
        </div>
      )}

      {jaAbertas.has('limites') && (
        <div className={aba === 'limites' ? '' : 'hidden'}>
          <LimitesCategorias
            mesAtual={mesAtual}
            cartao1Nome={cartao1Nome}
            cartao2Nome={cartao2Nome}
            embutido
          />
        </div>
      )}
    </div>
  )
}
