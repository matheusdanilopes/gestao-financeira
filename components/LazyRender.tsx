'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Altura do placeholder enquanto o conteúdo não entrou em tela */
  alturaPlaceholder?: number
  /** Antecipação da montagem em relação à viewport */
  margem?: string
}

/**
 * Monta o conteúdo só quando ele entra (ou está prestes a entrar) na viewport, e
 * daí em diante o mantém montado.
 *
 * A aba "Gráficos" do Dashboard tem oito cards; sem isto, abri-la dispara o fetch
 * de todos ao mesmo tempo, inclusive os que estão muito abaixo da dobra. Como o
 * conteúdo nunca é desmontado depois, os caches internos de cada gráfico
 * continuam valendo ao navegar entre meses.
 *
 * Enquanto a aba está escondida (display:none) nada intersecta, então o
 * carregamento só começa de fato quando o usuário abre a aba.
 */
export default function LazyRender({ children, alturaPlaceholder = 240, margem = '250px' }: Props) {
  const [visivel, setVisivel] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Callback ref: reconecta o observer sempre que o placeholder monta, sem
  // depender de um segundo efeito para o caso de o nó aparecer depois.
  const sentinelaRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setVisivel(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          observer.disconnect()
          observerRef.current = null
          setVisivel(true)
        }
      },
      { rootMargin: margem },
    )
    observer.observe(el)
    observerRef.current = observer
  }, [margem])

  if (visivel) return <>{children}</>

  return (
    <div
      ref={sentinelaRef}
      className="skeleton rounded-2xl"
      style={{ height: alturaPlaceholder }}
      aria-hidden="true"
    />
  )
}
