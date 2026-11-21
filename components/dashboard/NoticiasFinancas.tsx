'use client'

import React, { useMemo } from 'react'
import { Newspaper, ExternalLink } from 'lucide-react'
import { tempoRelativo, type Noticia } from '@/lib/mercado'
import CarrosselRotativo from './CarrosselRotativo'
import { useJsonPublico } from './useJsonPublico'

/**
 * Card de notícias de finanças (InfoMoney, Valor, g1 Economia) que troca de
 * manchete sozinho. Toque na manchete abre a matéria. Some se o feed não carregar.
 */
export default function NoticiasFinancas() {
  const dados = useJsonPublico<{ noticias: Noticia[] }>('/api/noticias', 'dashboard:noticias', 30 * 60_000)
  const noticias = useMemo(() => (dados?.noticias ?? []).slice(0, 8), [dados])

  const itens = useMemo(() => noticias.map(n => ({
    chave: n.link,
    conteudo: (
      <a
        href={n.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block min-h-[64px] rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
          <span className="font-bold text-primary-600 dark:text-primary-300">{n.fonte}</span>
          {n.data && <span>· {tempoRelativo(n.data)}</span>}
          <ExternalLink className="w-3 h-3 ml-auto shrink-0" aria-hidden="true" />
        </p>
        <p className="mt-1.5 text-[14.5px] font-semibold leading-snug text-gray-800 dark:text-gray-100 line-clamp-2 [text-wrap:balance]">
          {n.titulo}
        </p>
      </a>
    ),
  })), [noticias])

  if (itens.length === 0) return null

  return (
    <section className="bg-white rounded-3xl shadow-soft p-4" aria-label="Notícias de finanças">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-sky-50 dark:bg-white/10 flex items-center justify-center">
          <Newspaper className="w-4 h-4 text-sky-600 dark:text-sky-300" />
        </div>
        <h2 className="text-base font-semibold text-gray-800">Notícias</h2>
      </div>
      <CarrosselRotativo itens={itens} intervaloMs={7000} rotulo="Notícias de finanças" />
    </section>
  )
}
