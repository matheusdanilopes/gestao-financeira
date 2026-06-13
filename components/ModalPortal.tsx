'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Resolve once and cache — avoids repeated DOM queries on re-renders
    rootRef.current = document.getElementById('modal-root') ?? document.body
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted || !rootRef.current) return null

  return createPortal(children, rootRef.current)
}
