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
        className="p-0.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-800
                   active:scale-90 transition-all duration-150 focus:outline-none"
        aria-label="Mais informações"
        aria-expanded={aberto}
      >
        <Info className="w-4 h-4" />
      </button>
      {aberto && (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 350 }}
          className="w-64 animate-in
                     bg-gray-900 dark:bg-gray-950
                     text-white text-sm rounded-2xl
                     shadow-float
                     border border-white/10
                     p-3.5"
        >
          <button
            onClick={() => setAberto(false)}
            className="absolute top-2.5 right-2.5
                       text-gray-500 hover:text-gray-200
                       p-0.5 rounded-lg
                       hover:bg-white/10
                       transition-all duration-150 focus:outline-none"
            aria-label="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <p className="pr-6 leading-relaxed text-gray-200 text-[13px]">{texto}</p>
        </div>
      )}
    </span>
  )
}
