'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

const SWIPE_REVEAL_WIDTH = 72
const SWIPE_DELETE_THRESHOLD = -60

export function SwipeableItem({
  children,
  onDelete,
  disabled = false,
}: {
  children: ReactNode
  onDelete: () => void
  disabled?: boolean
}) {
  const [translateX, setTranslateX] = useState(0)
  const [animating, setAnimating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const onDeleteRef = useRef(onDelete)

  useEffect(() => { onDeleteRef.current = onDelete })

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
        onDeleteRef.current()
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

  return (
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
  )
}
