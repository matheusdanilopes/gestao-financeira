'use client'

import { memo, useId } from 'react'

/**
 * Rosto do assistente: um robozinho em SVG que pisca, flutua, olha para os
 * lados e muda de expressão conforme o que está acontecendo na conversa.
 *
 * Tudo é CSS (keyframes `robo-*` em globals.css): nenhum timer em JS, nenhum
 * re-render por quadro. Com `prefers-reduced-motion` a regra global de
 * globals.css congela as animações e ele fica parado, mas com a expressão
 * certa.
 */

export type HumorRobo = 'idle' | 'pensando' | 'falando' | 'ouvindo' | 'feliz'

export const RoboAvatar = memo(function RoboAvatar({
  humor = 'idle',
  tamanho = 40,
  estatico = false,
  className = '',
  titulo,
}: {
  humor?: HumorRobo
  /** Lado em px. */
  tamanho?: number
  /** Sem animação — para avatares do histórico, que seriam só ruído visual. */
  estatico?: boolean
  className?: string
  /** Texto para leitores de tela; sem ele o avatar é decorativo. */
  titulo?: string
}) {
  // Ids próprios por instância: o mesmo gradiente repetido em vários SVGs da
  // página quebra quando a primeira instância some da árvore.
  const uid = useId().replace(/:/g, '')
  const gCabeca = `robo-cabeca-${uid}`
  const gBrilho = `robo-brilho-${uid}`
  const feliz = humor === 'feliz'
  const falando = humor === 'falando'

  return (
    <svg
      viewBox="0 0 64 64"
      width={tamanho}
      height={tamanho}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      className={`robo robo--${humor} ${estatico ? 'robo--estatico' : ''} overflow-visible shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={gCabeca} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe4f3" />
        </linearGradient>
        <radialGradient id={gBrilho} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#a5f3fc" />
          <stop offset="1" stopColor="#22d3ee" />
        </radialGradient>
      </defs>

      {/* Sombra no "chão": encolhe quando ele sobe. */}
      <ellipse className="robo-sombra" cx="32" cy="61" rx="15" ry="2.2" fill="currentColor" opacity="0.18" />

      <g className="robo-corpo">
        <g className="robo-cabeca">
          {/* Antena */}
          <line x1="32" y1="13" x2="32" y2="6.5" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" />
          <circle className="robo-antena" cx="32" cy="5" r="3.4" />

          {/* Orelhas */}
          <rect x="5" y="26" width="6" height="13" rx="3" fill="#94a3b8" />
          <rect x="53" y="26" width="6" height="13" rx="3" fill="#94a3b8" />

          {/* Cabeça */}
          <rect x="9" y="12" width="46" height="40" rx="15" fill={`url(#${gCabeca})`} stroke="#cbd5e1" strokeWidth="1" />

          {/* Tela do rosto */}
          <rect x="14" y="18" width="36" height="27" rx="10" fill="#0f1b3d" />
          <rect x="16" y="19.5" width="18" height="3" rx="1.5" fill="#ffffff" opacity="0.08" />

          {/* Bochechas */}
          <circle className="robo-bochecha" cx="19.5" cy="37" r="2.6" fill="#f472b6" />
          <circle className="robo-bochecha" cx="44.5" cy="37" r="2.6" fill="#f472b6" />

          {/* Olhos: o grupo olha para os lados, cada olho pisca sozinho. */}
          <g className="robo-olhar">
            {feliz ? (
              <>
                <path d="M21.5 31.5 Q25 26.5 28.5 31.5" fill="none" stroke={`url(#${gBrilho})`} strokeWidth="2.8" strokeLinecap="round" />
                <path d="M35.5 31.5 Q39 26.5 42.5 31.5" fill="none" stroke={`url(#${gBrilho})`} strokeWidth="2.8" strokeLinecap="round" />
              </>
            ) : (
              <>
                <rect className="robo-olho" x="21.5" y="25.5" width="7" height="9" rx="3.5" fill={`url(#${gBrilho})`} />
                <rect className="robo-olho" x="35.5" y="25.5" width="7" height="9" rx="3.5" fill={`url(#${gBrilho})`} />
                <circle cx="26.6" cy="27.8" r="1.2" fill="#ffffff" opacity="0.85" />
                <circle cx="40.6" cy="27.8" r="1.2" fill="#ffffff" opacity="0.85" />
              </>
            )}
          </g>

          {/* Boca */}
          {falando ? (
            <rect className="robo-boca-falando" x="28" y="37.5" width="8" height="4" rx="2" fill="#22d3ee" />
          ) : (
            <path
              d={feliz ? 'M26.5 37.5 Q32 43 37.5 37.5' : humor === 'pensando' ? 'M28.5 39.5 Q32 38.5 35.5 39.5' : 'M27.5 38 Q32 41.5 36.5 38'}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </g>

        {/* Ondinhas de som enquanto escuta */}
        {humor === 'ouvindo' && (
          <g className="robo-ondas" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
            <path d="M60 27 Q63 32.5 60 38" />
            <path d="M4 27 Q1 32.5 4 38" />
          </g>
        )}
      </g>
    </svg>
  )
})
