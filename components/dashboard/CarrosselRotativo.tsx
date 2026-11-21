'use client'

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export interface ItemCarrossel {
  chave: string
  conteudo: ReactNode
}

interface Props {
  itens: ItemCarrossel[]
  /** Tempo de cada item na tela. */
  intervaloMs?: number
  /** 'inverse': sobre o topo colorido do Dashboard. */
  tone?: 'default' | 'inverse'
  /**
   * Com true, tocar no carrossel abre todos os itens empilhados (e para de
   * girar); "Recolher" fecha e volta a girar. Sem ele, o toque só pausa.
   */
  expansivel?: boolean
  rotulo: string
  className?: string
}

function usePrefereMenosMovimento(): boolean {
  const [reduzir, setReduzir] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduzir(mq.matches)
    const on = (e: MediaQueryListEvent) => setReduzir(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduzir
}

/**
 * Carrossel que troca sozinho de item. Toque pausa (ou abre tudo, se
 * `expansivel`), deslizar troca de item, as bolinhas levam direto a um item.
 * Com "reduzir movimento" no sistema ele não gira — só troca na mão.
 */
export default function CarrosselRotativo({
  itens, intervaloMs = 6000, tone = 'default', expansivel = false, rotulo, className = '',
}: Props) {
  const [indice, setIndice] = useState(0)
  const [pausado, setPausado] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const [visivel, setVisivel] = useState(true)
  const reduzir = usePrefereMenosMovimento()
  const inicioToque = useRef<{ x: number; y: number } | null>(null)
  const deslizou = useRef(false)

  const total = itens.length
  const atual = total > 0 ? Math.min(indice, total - 1) : 0
  const girando = total > 1 && !pausado && !expandido && !reduzir && visivel

  // Não gira com a aba em segundo plano: ao voltar, o usuário vê a troca.
  useEffect(() => {
    const on = () => setVisivel(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  useEffect(() => {
    if (!girando) return
    const t = setTimeout(() => setIndice(i => (i + 1) % total), intervaloMs)
    return () => clearTimeout(t)
  }, [girando, atual, total, intervaloMs])

  const irPara = useCallback((n: number) => setIndice(((n % total) + total) % total), [total])

  const onPointerDown = (e: React.PointerEvent) => { inicioToque.current = { x: e.clientX, y: e.clientY } }
  const onPointerUp = (e: React.PointerEvent) => {
    const ini = inicioToque.current
    inicioToque.current = null
    if (!ini || expandido || total < 2) return
    const dx = e.clientX - ini.x
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - ini.y)) {
      deslizou.current = true
      irPara(atual + (dx < 0 ? 1 : -1))
    }
  }

  // Fechado e expansível: o primeiro toque abre o carrossel e não aciona o
  // que estiver dentro do item. Aberto, os toques chegam normalmente ao conteúdo.
  const onClickCapture = (e: React.MouseEvent) => {
    if (deslizou.current) {
      deslizou.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (expansivel && !expandido && !(e.target as HTMLElement).closest('[data-carrossel-dot]')) {
      e.preventDefault()
      e.stopPropagation()
      setExpandido(true)
    }
  }
  const onClick = (e: React.MouseEvent) => {
    if (expansivel) return
    // Links e botões dentro do item continuam funcionando; o resto pausa.
    if ((e.target as HTMLElement).closest('a,button')) return
    setPausado(p => !p)
  }

  if (total === 0) return null

  const inverse = tone === 'inverse'
  const corDot = inverse ? 'bg-white/35' : 'bg-gray-300 dark:bg-white/25'
  const corDotAtivo = inverse ? 'bg-white' : 'bg-primary-600 dark:bg-primary-300'
  const corAcao = inverse ? 'text-white/85' : 'text-primary-600 dark:text-primary-300'

  if (expandido) {
    return (
      <div className={className} role="region" aria-label={rotulo}>
        <div className="flex justify-end -mt-1 mb-1">
          <button
            type="button"
            onClick={() => setExpandido(false)}
            aria-expanded="true"
            className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${corAcao} px-2 py-1 rounded-full
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
          >
            Recolher <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/10">
          {itens.map((it, i) => (
            <div key={it.chave} className={`list-item-enter ${i === 0 ? 'pb-3' : 'py-3'}`} style={{ animationDelay: `${i * 40}ms` }}>
              {it.conteudo}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`relative overflow-hidden select-none touch-pan-y cursor-pointer ${className}`}
      role="region"
      aria-roledescription="carrossel"
      aria-label={rotulo}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
      onClick={onClick}
    >
      {expansivel && (
        <span className={`absolute right-0 top-0 inline-flex items-center gap-0.5 text-[11px] font-semibold ${corAcao}`} aria-hidden="true">
          Ver tudo <ChevronDown className="w-3.5 h-3.5" />
        </span>
      )}
      <div key={itens[atual].chave} className="carrossel-slide-enter" aria-live={girando ? 'off' : 'polite'}>
        {itens[atual].conteudo}
      </div>
      {total > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {itens.map((it, i) => (
            <button
              key={it.chave}
              type="button"
              data-carrossel-dot
              aria-label={`Item ${i + 1} de ${total}`}
              aria-current={i === atual || undefined}
              onClick={e => { e.stopPropagation(); irPara(i) }}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === atual ? `w-4 ${corDotAtivo}` : `w-1.5 ${corDot}`}
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
            />
          ))}
        </div>
      )}
      {girando && inverse && (
        <span
          key={`p-${atual}`}
          aria-hidden="true"
          className="carrossel-progresso absolute left-0 bottom-0 h-0.5 bg-white/50"
          style={{ '--carrossel-ms': `${intervaloMs}ms` } as React.CSSProperties}
        />
      )}
    </div>
  )
}
