'use client'

import { useState, useRef, useEffect } from 'react'
import { Info, X } from 'lucide-react'

interface InfoPopoverProps {
  texto: string
}

export function InfoPopover({ texto }: InfoPopoverProps) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  function handleOpen() {
    if (!btnRef.current) return
    const btn = btnRef.current.getBoundingClientRect()
    const popWidth = 256
    const popHeight = 120
    const margin = 12

    let top = btn.bottom + 6
    let left = btn.left

    if (left + popWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - popWidth)
    }
    if (top + popHeight > window.innerHeight - margin) {
      top = btn.top - popHeight - 6
    }

    setPos({ top, left })
    setAberto(true)
  }

  useEffect(() => {
    if (!aberto) return
    function onClickOutside(e: MouseEvent) {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [aberto])

  return (
    <span className="inline-flex items-center flex-shrink-0">
      <button
        ref={btnRef}
        onClick={() => aberto ? setAberto(false) : handleOpen()}
        className="text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Mais informações"
      >
        <Info className="w-4 h-4" />
      </button>
      {aberto && (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-64 bg-gray-900 text-white text-sm rounded-xl shadow-float p-3"
        >
          <button
            onClick={() => setAberto(false)}
            className="absolute top-2 right-2 text-gray-400 hover:text-white transition-colors"
            aria-label="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <p className="pr-5 leading-relaxed text-gray-100">{texto}</p>
        </div>
      )}
    </span>
  )
}
