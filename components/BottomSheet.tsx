'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode, type CSSProperties } from 'react'
import ModalPortal from './ModalPortal'

const ANIM_MS = 220

// Pilha dos sheets abertos: o Escape fecha apenas o do topo, e não todos os
// que estiverem montados ao mesmo tempo (ex: sheet de item sobre sheet da lista).
const sheetStack: symbol[] = []

/**
 * Bottom sheet com animação simétrica de entrada e saída.
 * Diferente de montar/desmontar via CSS `animation` (que só anima a entrada),
 * usa um estado `visible` + transition, então `close()` espera a transição de
 * saída terminar antes de desmontar de fato — evita o corte seco ao fechar.
 */
export function BottomSheet({
  onClose,
  children,
  sheetClassName = '',
  overlayStyle,
}: {
  onClose: () => void
  children: ReactNode | ((close: () => void) => ReactNode)
  sheetClassName?: string
  overlayStyle?: CSSProperties
}) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [id] = useState(() => Symbol('bottom-sheet'))

  // onClose costuma ser uma arrow inline, então muda de identidade a cada
  // render — guardá-la numa ref evita reiniciar o timer de fechamento.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    // Double rAF garante que o elemento já foi pintado antes da transição iniciar
    const rafId = requestAnimationFrame(() =>
      requestAnimationFrame(() => setVisible(true))
    )
    return () => cancelAnimationFrame(rafId)
  }, [])

  // `close` só sinaliza; o timer vive no efeito abaixo, que o cancela se o
  // sheet for desmontado no meio da animação de saída. Como `closing` é um
  // booleano, fechar duas vezes (clique no overlay + Esc) não reagenda nada —
  // onClose continua sendo chamado uma única vez.
  const close = useCallback(() => {
    setVisible(false)
    setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => onCloseRef.current(), ANIM_MS)
    return () => clearTimeout(t)
  }, [closing])

  // Entra/sai da pilha uma única vez, no mount — não a cada troca de onClose,
  // senão um sheet de baixo voltaria para o topo da pilha ao re-renderizar.
  useEffect(() => {
    sheetStack.push(id)
    return () => {
      const i = sheetStack.lastIndexOf(id)
      if (i !== -1) sheetStack.splice(i, 1)
    }
  }, [id])

  // Escape em listener global: o handler ficava no onKeyDown da div do overlay,
  // que não é focável (sem tabIndex), então só disparava quando o foco já estava
  // dentro do sheet — normalmente não estava, e Esc não fechava nada.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (sheetStack[sheetStack.length - 1] !== id) return // não é o sheet do topo
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close, id])

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[200] flex items-end"
        style={{
          backgroundColor: visible ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
          transition: `background-color ${ANIM_MS}ms ease`,
          ...overlayStyle,
        }}
        onClick={e => e.target === e.currentTarget && close()}
      >
        <div
          className={`w-full bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl ${sheetClassName}`}
          style={{
            transform: visible ? 'translateY(0)' : 'translateY(100%)',
            transition: `transform ${ANIM_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
          }}
          onClick={e => e.stopPropagation()}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      </div>
    </ModalPortal>
  )
}
