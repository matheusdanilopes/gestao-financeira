'use client'

// Um cartão adicional da fatura do cartão principal. Antes este bloco existia em
// três cópias JSX quase idênticas no Dashboard (Matheus azul, Jeniffer rosa,
// Conjunto roxo), o que travava a quantidade de cartões em três; agora é um
// componente só, e a lista de blocos vem dos dados.

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { formatBRL as fmt } from '@/lib/logger'
import { estiloResponsavel } from '@/lib/responsavelStyle'

export interface ComposicaoGastos {
  existente: number
  novo: number
  assinatura: number
}

export interface ProjecaoItem {
  descricao: string
  valor: number
  responsavel: string
  cartao: string
  parcela_atual: number
  total_parcelas: number
}

export interface AssinDivergente {
  nome: string
  valorEsperado: number
  valorCobrado: number
  diff: number
}

export interface BlocoPrincipal {
  responsavel: string
  nomes: string[]
  previsto: number
  atual: number
  projecaoParcelas: number
  projecaoItens: ProjecaoItem[]
  composicao: ComposicaoGastos
  assinaturasNaoPagas: number
  assinaturasDivergentes: AssinDivergente[]
  sobra: number
}

/** Traduz o valor "atual" da barra em segmentos empilháveis (percentual da largura). */
export function calcularSegmentosBarra(
  atual: number,
  previsto: number,
  composicao: ComposicaoGastos
) {
  const pct = previsto > 0 ? Math.min(100, (atual / previsto) * 100) : 0
  if (atual <= 0) return { pct, existente: 0, novo: 0, assinatura: 0 }
  return {
    pct,
    existente: (composicao.existente / atual) * pct,
    novo: (composicao.novo / atual) * pct,
    assinatura: (composicao.assinatura / atual) * pct,
  }
}

interface Props {
  bloco: BlocoPrincipal
  onComposicao: (responsavel: string, atual: number, composicao: ComposicaoGastos) => void
  onProjecao: (responsavel: string, valor: number, itens: ProjecaoItem[]) => void
}

export default function BlocoFaturaPrincipal({ bloco, onComposicao, onProjecao }: Props) {
  const cor = estiloResponsavel(bloco.responsavel)
  const seg = calcularSegmentosBarra(bloco.atual, bloco.previsto, bloco.composicao)
  const sobraWarning =
    bloco.sobra >= 0 && bloco.previsto > 0 && (bloco.sobra / bloco.previsto) * 100 <= 10
  const pct = bloco.previsto > 0 ? Math.min(100, (bloco.atual / bloco.previsto) * 100) : 0

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${cor.ponto}`} />
          <span className="text-sm font-semibold text-gray-800 truncate">{bloco.responsavel}</span>
        </div>
        <span className="text-sm font-medium text-gray-700 num shrink-0">
          {fmt(bloco.atual)} / {bloco.previsto > 0 ? bloco.previsto.toLocaleString('pt-BR') : '–'}
        </span>
      </div>

      <button
        type="button"
        onClick={bloco.atual > 0 ? () => onComposicao(bloco.responsavel, bloco.atual, bloco.composicao) : undefined}
        className={`fatura-track flex w-full h-2.5 ${cor.trilho} rounded-full overflow-hidden mb-0.5 ${bloco.atual > 0 ? 'cursor-pointer' : 'cursor-default'}`}
        aria-label={`Ver composição da fatura de ${bloco.responsavel}`}
      >
        <div key={`ex-${bloco.atual}`} className={`h-full ${cor.segExistente} bar-enter`} style={{ '--bar-w': `${seg.existente}%` } as React.CSSProperties} />
        <div key={`no-${bloco.atual}`} className={`h-full ${cor.segNovo} bar-enter`} style={{ '--bar-w': `${seg.novo}%` } as React.CSSProperties} />
        <div key={`as-${bloco.atual}`} className={`h-full ${cor.segAssinatura} bar-enter`} style={{ '--bar-w': `${seg.assinatura}%` } as React.CSSProperties} />
      </button>

      <div className="flex items-center justify-between mb-1">
        {bloco.projecaoParcelas > 0 ? (
          <button
            type="button"
            onClick={() => onProjecao(bloco.responsavel, bloco.projecaoParcelas, bloco.projecaoItens)}
            className="text-[11px] text-orange-500 font-medium underline decoration-dotted underline-offset-2"
          >
            parc. prev. − {fmt(bloco.projecaoParcelas)}
          </button>
        ) : (
          <span className="text-[11px] text-gray-400">{sobraWarning ? 'limite quase no teto' : ''}</span>
        )}
        <span className="text-[11px] text-gray-400 num">{pct.toFixed(0)}%</span>
      </div>

      {bloco.assinaturasDivergentes.length > 0 && (
        <div className="mb-1">
          {bloco.assinaturasDivergentes.map((d) => (
            <div key={d.nome} className="flex justify-between text-[11px] gap-1 text-amber-600">
              <span className="truncate shrink" title={d.nome}>⚠ {d.nome}</span>
              <span className="font-medium num shrink-0 whitespace-nowrap">{d.diff > 0 ? '+' : ''}{fmt(d.diff)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
          bloco.sobra < 0
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            : sobraWarning
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
              : cor.badge
        }`}>
          {bloco.sobra < 0
            ? <><AlertTriangle className="w-3 h-3" /> Excesso {fmt(Math.abs(bloco.sobra))}</>
            : sobraWarning
              ? <><AlertTriangle className="w-3 h-3" /> Atenção {fmt(Math.abs(bloco.sobra))}</>
              : <>✓ Restante {fmt(Math.abs(bloco.sobra))}</>}
        </div>
        {bloco.assinaturasNaoPagas > 0 && (
          <span className="text-[11px] text-indigo-500 num shrink-0">Assin. {fmt(bloco.assinaturasNaoPagas)}</span>
        )}
      </div>
    </div>
  )
}
