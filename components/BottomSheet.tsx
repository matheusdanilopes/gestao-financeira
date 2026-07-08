'use client'

import { useState, useEffect, useCallback, type ReactNode, type CSSProperties } from 'react'
import ModalPortal from './ModalPortal'

const ANIM_MS = 220

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

  useEffect(() => {
    // Double rAF garante que o elemento já foi pintado antes da transição iniciar
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setVisible(true))
    )
    return () => cancelAnimationFrame(id)
  }, [])

  const close = useCallback(() => {
    setVisible(false)
    setTimeout(onClose, ANIM_MS)
  }, [onClose])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') close()
  }

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        onKeyDown={handleKeyDown}
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
