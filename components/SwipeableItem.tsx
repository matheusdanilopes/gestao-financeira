'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'

const SWIPE_REVEAL_WIDTH = 72
const SWIPE_DELETE_THRESHOLD = -60

export function SwipeableItem({
  children,
  onDelete,
  disabled = false,
  requireConfirmation = false,
}: {
  children: ReactNode
  onDelete: () => void
  disabled?: boolean
  requireConfirmation?: boolean
}) {
  const [translateX, setTranslateX] = useState(0)
  const [animating, setAnimating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const onDeleteRef = useRef(onDelete)
  const requireConfirmationRef = useRef(requireConfirmation)

  useEffect(() => { onDeleteRef.current = onDelete })
  useEffect(() => { requireConfirmationRef.current = requireConfirmation }, [requireConfirmation])

  useEffect(() => {
    const el = containerRef.current
    if (!el || disabled) return

    let startX = 0, startY = 0
    let active = false
    let direction: 'h' | 'v' | null = null
    let currentDx = 0

    function onTouchStart(e: TouchEvent) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      active = true
      direction = null
      currentDx = 0
    }

    function onTouchMove(e: TouchEvent) {
      if (!active) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (direction === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        direction = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      }
      if (direction !== 'h' || dx >= 0) return
      e.preventDefault()
      currentDx = Math.max(dx, -SWIPE_REVEAL_WIDTH * 1.5)
      setTranslateX(currentDx)
      setAnimating(false)
    }

    function onTouchEnd() {
      if (!active) return
      const wasHorizontal = direction === 'h'
      active = false
      direction = null
      if (!wasHorizontal) return
      setAnimating(true)
      if (currentDx <= SWIPE_DELETE_THRESHOLD) {
        if (requireConfirmationRef.current) {
          setShowConfirm(true)
        } else {
          onDeleteRef.current()
        }
      }
      setTranslateX(0)
      currentDx = 0
    }

    function onTouchCancel() {
      active = false
      direction = null
      currentDx = 0
      setAnimating(true)
      setTranslateX(0)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [disabled])

  const revealProgress = Math.min(Math.abs(translateX) / SWIPE_REVEAL_WIDTH, 1)

  const handleConfirm = useCallback(() => {
    setShowConfirm(false)
    onDeleteRef.current()
  }, [])

  const handleCancel = useCallback(() => {
    setShowConfirm(false)
  }, [])

  return (
    <>
      <div ref={containerRef} className="relative overflow-hidden select-none">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500"
          style={{ width: SWIPE_REVEAL_WIDTH, opacity: revealProgress }}
        >
          <Trash2 className="w-5 h-5 text-white" />
        </div>
        <div
          style={{
            transform: `translateX(${translateX}px)`,
            transition: animating ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
            willChange: translateX !== 0 ? 'transform' : 'auto',
          }}
        >
          {children}
        </div>
      </div>
      {showConfirm && (
        <DeleteConfirmSheet onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </>
  )
}

function DeleteConfirmSheet({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  const [visible, setVisible] = useState(false)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const ANIM_MS = 220

  useEffect(() => {
    // Double rAF ensures the element is painted before the transition starts
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setVisible(true))
    )
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (visible) cancelBtnRef.current?.focus()
  }, [visible])

  function dismiss(cb: () => void) {
    setVisible(false)
    setTimeout(cb, ANIM_MS)
  }

  function handleBackdropClick() {
    dismiss(onCancel)
  }

  function handleCancel() {
    dismiss(onCancel)
  }

  function handleConfirm() {
    dismiss(onConfirm)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') handleCancel()
  }

  const content = (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar exclusão"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-end"
      style={{
        backgroundColor: visible ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: `background-color ${ANIM_MS}ms ease`,
      }}
      onClick={handleBackdropClick}
    >
      {/* Sheet */}
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${ANIM_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Body */}
        <div className="px-5 pt-3 pb-4">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-none">
              <Trash2 className="w-5 h-5 text-red-500" aria-hidden="true" />
            </div>
            <div>
              <p
                id="delete-confirm-title"
                className="text-[15px] font-semibold text-gray-900 dark:text-white leading-snug"
              >
                Deseja remover este item?
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                O item será excluído da lista.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={handleCancel}
              className="flex-1 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300
                         font-semibold text-sm transition-colors
                         hover:bg-gray-200 dark:hover:bg-gray-700
                         active:scale-[0.97] active:bg-gray-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 h-12 rounded-xl bg-red-500 text-white font-semibold text-sm
                         transition-colors
                         hover:bg-red-600 active:bg-red-600 active:scale-[0.97]"
            >
              Excluir
            </button>
          </div>
        </div>

        {/* Safe area for notched phones */}
        <div style={{ height: 'env(safe-area-inset-bottom, 8px)' }} />
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(content, document.getElementById('modal-root') ?? document.body)
}
