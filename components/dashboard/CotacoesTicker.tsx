'use client'

import React from 'react'
import { formatarCotacao, type Cotacao } from '@/lib/mercado'
import { useJsonPublico } from './useJsonPublico'

function Item({ c }: { c: Cotacao }) {
  const v = c.variacao
  const cor = v === null || Math.abs(v) < 0.005 ? 'text-gray-400' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  const seta = v === null || Math.abs(v) < 0.005 ? '' : v > 0 ? '▲ ' : '▼ '
  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs whitespace-nowrap">
      <span className="font-bold text-gray-800 dark:text-gray-100">{c.nome}</span>
      <span className="num text-gray-700 dark:text-gray-300">{formatarCotacao(c)}</span>
      {c.detalhe && <span className="text-gray-500 dark:text-gray-400">{c.detalhe}</span>}
      {v !== null && (
        <span className={`num ${cor}`}>{seta}{Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% hoje</span>
      )}
    </span>
  )
}

/**
 * Faixa de cotações do Dashboard: dólar, Ibovespa, Selic e inflação, com
 * nomes por extenso, rolando em loop. Some se nada carregar.
 */
export default function CotacoesTicker() {
  const dados = useJsonPublico<{ cotacoes: Cotacao[] }>('/api/mercado', 'dashboard:cotacoes-v2', 15 * 60_000)
  const cotacoes = dados?.cotacoes ?? []
  if (cotacoes.length === 0) return null

  const lista = (dup: boolean) => (
    <div className={`flex gap-6 pr-6 shrink-0 ${dup ? 'ticker-dup' : ''}`} aria-hidden={dup || undefined}>
      {cotacoes.map(c => <Item key={c.nome} c={c} />)}
    </div>
  )

  return (
    <div
      className="ticker ticker-mask overflow-hidden bg-white dark:bg-white/5 border-y border-gray-100 dark:border-white/10 py-2 -mx-4 md:-mx-6 lg:mx-0 lg:rounded-2xl lg:border"
      aria-label="Cotações do dia"
      role="marquee"
    >
      <div className="ticker-track flex w-max pl-4" style={{ '--ticker-s': `${Math.max(24, cotacoes.length * 7)}s` } as React.CSSProperties}>
        {lista(false)}
        {lista(true)}
      </div>
    </div>
  )
}
