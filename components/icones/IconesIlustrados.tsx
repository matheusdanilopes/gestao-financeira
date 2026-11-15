'use client'

import { memo, useId, type ReactNode } from 'react'

/**
 * Ícones ilustrados da navegação, no mesmo estilo do Fin (RoboAvatar): SVG
 * 64×64 preenchido, com gradiente vertical claro→saturado, brilho sutil,
 * sombra no "chão" e a mesma paleta do robô (navy da tela, ciano, rosa,
 * âmbar, esmeralda). Cores fixas — funcionam igual no claro e no escuro.
 *
 * Mesma assinatura dos ícones do lucide (`className`, `strokeWidth`), para
 * entrar onde eles entram; o tamanho vem das classes w-/h- da className e
 * `strokeWidth` é ignorado.
 */

export type IconeIlustradoProps = { className?: string; strokeWidth?: number }

// Paleta compartilhada com o RoboAvatar.
const NAVY = '#0f1b3d'
const CONTORNO = '#cbd5e1'
const ARDOSIA = '#94a3b8'
const CIANO = '#22d3ee'
const ROSA = '#f472b6'

/** Ids de gradiente únicos por instância (o mesmo id repetido na página quebra quando a 1ª some). */
function useIds() {
  const uid = useId().replace(/:/g, '')
  return (nome: string) => `ic-${nome}-${uid}`
}

function Grad({ id, de, ate }: { id: string; de: string; ate: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={de} />
      <stop offset="1" stopColor={ate} />
    </linearGradient>
  )
}

function Base({ className = '', defs, children }: { className?: string; defs?: ReactNode; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={24}
      height={24}
      aria-hidden="true"
      className={`overflow-visible shrink-0 ${className}`}
    >
      {defs && <defs>{defs}</defs>}
      <ellipse cx="32" cy="60.5" rx="16" ry="2.2" fill="currentColor" opacity="0.16" />
      {children}
    </svg>
  )
}

// ── Navegação principal ───────────────────────────────────────────────────────

export const IconePainel = memo(function IconePainel({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('a')} de="#fde68a" ate="#f59e0b" />
        <Grad id={id('e')} de="#6ee7b7" ate="#10b981" />
        <Grad id={id('r')} de="#f9a8d4" ate="#ec4899" />
      </>}
    >
      <rect x="7" y="9" width="50" height="46" rx="14" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <rect x="13" y="15" width="24" height="19" rx="6" fill={NAVY} />
      <path d="M17 29 L22 24 L26.5 27 L33 20" fill="none" stroke={CIANO} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="40" y="15" width="11" height="19" rx="5" fill={`url(#${id('a')})`} />
      <rect x="13" y="38" width="11" height="11" rx="5" fill={`url(#${id('e')})`} />
      <rect x="27" y="38" width="24" height="11" rx="5" fill={`url(#${id('r')})`} />
    </Base>
  )
})

export const IconeCarteira = memo(function IconeCarteira({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('n')} de="#a7f3d0" ate="#34d399" />
        <Grad id={id('c')} de="#60a5fa" ate="#2563eb" />
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('a')} de="#fde68a" ate="#f59e0b" />
      </>}
    >
      {/* Nota aparecendo por trás */}
      <g transform="rotate(-9 32 17)">
        <rect x="13" y="7" width="36" height="22" rx="4" fill={`url(#${id('n')})`} stroke="#10b981" strokeWidth="0.8" />
        <circle cx="31" cy="15" r="4" fill="#10b981" opacity="0.55" />
      </g>
      <rect x="6" y="18" width="52" height="37" rx="12" fill={`url(#${id('c')})`} />
      <rect x="11" y="21.5" width="26" height="3" rx="1.5" fill="#ffffff" opacity="0.3" />
      <rect x="37" y="29" width="23" height="15" rx="7.5" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <circle cx="45" cy="36.5" r="3.4" fill={`url(#${id('a')})`} />
    </Base>
  )
})

export const IconeCartao = memo(function IconeCartao({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('t')} de="#a5f3fc" ate="#06b6d4" />
        <Grad id={id('f')} de="#1e3a8a" ate={NAVY} />
        <Grad id={id('a')} de="#fde68a" ate="#f59e0b" />
      </>}
    >
      <rect x="13" y="9" width="44" height="30" rx="7" fill={`url(#${id('t')})`} transform="rotate(-10 35 24)" />
      <rect x="6" y="20" width="50" height="34" rx="8" fill={`url(#${id('f')})`} />
      <rect x="10" y="23" width="24" height="2.4" rx="1.2" fill="#ffffff" opacity="0.14" />
      <rect x="12" y="29" width="11" height="8.5" rx="2.5" fill={`url(#${id('a')})`} />
      <rect x="12" y="43" width="20" height="3" rx="1.5" fill="#ffffff" opacity="0.35" />
      <circle cx="42" cy="44.5" r="4.6" fill={ROSA} opacity="0.95" />
      <circle cx="48" cy="44.5" r="4.6" fill="#fbbf24" opacity="0.85" />
    </Base>
  )
})

export const IconeMais = memo(function IconeMais({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('c')} de="#a5f3fc" ate={CIANO} />
        <Grad id={id('r')} de="#fbcfe8" ate={ROSA} />
        <Grad id={id('a')} de="#fde68a" ate="#f59e0b" />
      </>}
    >
      <rect x="7" y="11" width="50" height="42" rx="15" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <circle cx="20" cy="32" r="5.5" fill={`url(#${id('c')})`} />
      <circle cx="32" cy="32" r="5.5" fill={`url(#${id('r')})`} />
      <circle cx="44" cy="32" r="5.5" fill={`url(#${id('a')})`} />
    </Base>
  )
})

// ── Finanças ──────────────────────────────────────────────────────────────────

export const IconeDespesas = memo(function IconeDespesas({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('v')} de="#fda4af" ate="#e11d48" />
      </>}
    >
      <path
        d="M16 6 H46 A4 4 0 0 1 50 10 V54 L45 50.5 L40 54 L35 50.5 L30 54 L25 50.5 L20 54 L15 50.5 L10 54 V12 A6 6 0 0 1 16 6 Z"
        fill={`url(#${id('b')})`}
        stroke={CONTORNO}
        strokeLinejoin="round"
      />
      <rect x="15" y="12" width="18" height="4.5" rx="2.25" fill={NAVY} />
      <rect x="15" y="22" width="29" height="2.8" rx="1.4" fill={CONTORNO} />
      <rect x="15" y="28" width="22" height="2.8" rx="1.4" fill={CONTORNO} />
      <rect x="15" y="34" width="26" height="2.8" rx="1.4" fill={CONTORNO} />
      <circle cx="47" cy="43" r="10" fill={`url(#${id('v')})`} stroke="#ffffff" strokeWidth="2" />
      <rect x="42" y="41.6" width="10" height="2.8" rx="1.4" fill="#ffffff" />
    </Base>
  )
})

export const IconeReceitas = memo(function IconeReceitas({ className }: IconeIlustradoProps) {
  const id = useIds()
  const moeda = (y: number) => (
    <g key={y}>
      <path d={`M8 ${y} v6 a15 5 0 0 0 30 0 v-6 Z`} fill="#d97706" />
      <ellipse cx="23" cy={y} rx="15" ry="5" fill={`url(#${id('a')})`} stroke="#f59e0b" strokeWidth="0.8" />
    </g>
  )
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('a')} de="#fef3c7" ate="#fbbf24" />
        <Grad id={id('e')} de="#6ee7b7" ate="#059669" />
      </>}
    >
      {[48, 41, 34].map(moeda)}
      <circle cx="44" cy="22" r="14" fill={`url(#${id('e')})`} stroke="#ffffff" strokeWidth="2" />
      <ellipse cx="39.5" cy="15.5" rx="4.5" ry="2.4" fill="#ffffff" opacity="0.3" transform="rotate(-30 39.5 15.5)" />
      <path d="M44 29.5 V15.5 M38 21 L44 15 L50 21" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  )
})

export const IconeCofrinho = memo(function IconeCofrinho({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('p')} de="#fbcfe8" ate="#f472b6" />
        <Grad id={id('a')} de="#fef3c7" ate="#fbbf24" />
      </>}
    >
      <rect x="16" y="44" width="7" height="12" rx="3.5" fill="#ec4899" />
      <rect x="36" y="44" width="7" height="12" rx="3.5" fill="#ec4899" />
      <path d="M10 34 Q4 33 6 27" fill="none" stroke="#ec4899" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 25 L21 13 L29 22 Z" fill="#f9a8d4" stroke="#ec4899" strokeWidth="1" strokeLinejoin="round" />
      <ellipse cx="30" cy="37" rx="21" ry="16" fill={`url(#${id('p')})`} />
      <ellipse cx="23" cy="30" rx="8" ry="3.2" fill="#ffffff" opacity="0.4" transform="rotate(-12 23 30)" />
      <ellipse cx="51" cy="38" rx="5.5" ry="6.5" fill="#f9a8d4" stroke="#ec4899" strokeWidth="1" />
      <ellipse cx="49.5" cy="36.5" rx="1" ry="1.6" fill="#be185d" />
      <ellipse cx="52.5" cy="36.5" rx="1" ry="1.6" fill="#be185d" />
      <circle cx="41" cy="31" r="2.2" fill={NAVY} />
      <rect x="23" y="22.5" width="13" height="3" rx="1.5" fill="#be185d" />
      <circle cx="29.5" cy="12" r="7" fill={`url(#${id('a')})`} stroke="#f59e0b" strokeWidth="1" />
      <rect x="28.3" y="8.5" width="2.4" height="7" rx="1.2" fill="#f59e0b" />
    </Base>
  )
})

// ── Cartão ────────────────────────────────────────────────────────────────────

export const IconeCarrinho = memo(function IconeCarrinho({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('l')} de="#fdba74" ate="#ea580c" />
        <Grad id={id('c')} de="#a5f3fc" ate="#06b6d4" />
        <Grad id={id('r')} de="#fbcfe8" ate="#ec4899" />
      </>}
    >
      <rect x="20" y="7" width="14" height="14" rx="3.5" fill={`url(#${id('c')})`} transform="rotate(-8 27 14)" />
      <circle cx="43" cy="14" r="6.5" fill={`url(#${id('r')})`} />
      <path d="M4 11 H11 L18 42 H50" fill="none" stroke="#64748b" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 18 H57 L52 38 A4 4 0 0 1 48 41 H18 Z" fill={`url(#${id('l')})`} strokeLinejoin="round" />
      <path d="M26 21 V38 M35 21 V38 M44 21 V38" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      <circle cx="22" cy="50" r="4.8" fill={NAVY} />
      <circle cx="46" cy="50" r="4.8" fill={NAVY} />
      <circle cx="22" cy="50" r="1.7" fill={ARDOSIA} />
      <circle cx="46" cy="50" r="1.7" fill={ARDOSIA} />
    </Base>
  )
})

export const IconeAssinaturas = memo(function IconeAssinaturas({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('i')} de="#a5b4fc" ate="#4f46e5" />
        <Grad id={id('c')} de="#a5f3fc" ate="#06b6d4" />
      </>}
    >
      <rect x="6" y="11" width="42" height="42" rx="10" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <path d="M16 11 H38 A10 10 0 0 1 48 21 V24 H6 V21 A10 10 0 0 1 16 11 Z" fill={`url(#${id('i')})`} />
      <rect x="15" y="6" width="4.4" height="10" rx="2.2" fill={ARDOSIA} />
      <rect x="34.6" y="6" width="4.4" height="10" rx="2.2" fill={ARDOSIA} />
      {[13, 21, 29].flatMap(x => [30, 38].map(y => (
        <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.6" fill={x === 21 && y === 30 ? '#6366f1' : CONTORNO} />
      )))}
      <circle cx="46" cy="46" r="12" fill={`url(#${id('c')})`} stroke="#ffffff" strokeWidth="2" />
      <g fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40.8 44 A5.5 5.5 0 0 1 50.6 42.6" />
        <path d="M50.6 38.9 L50.6 42.6 L47 41.5" />
        <path d="M51.2 48 A5.5 5.5 0 0 1 41.4 49.4" />
        <path d="M41.4 53.1 L41.4 49.4 L45 50.5" />
      </g>
    </Base>
  )
})

export const IconeParcelas = memo(function IconeParcelas({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('m')} de="#99f6e4" ate="#2dd4bf" />
        <Grad id={id('f')} de="#2dd4bf" ate="#0d9488" />
      </>}
    >
      <rect x="17" y="6" width="38" height="26" rx="7" fill="#ccfbf1" stroke="#99f6e4" />
      <rect x="12" y="14" width="42" height="28" rx="7.5" fill={`url(#${id('m')})`} />
      <rect x="7" y="23" width="46" height="31" rx="8.5" fill={`url(#${id('f')})`} />
      <rect x="13" y="30" width="19" height="3.6" rx="1.8" fill="#ffffff" opacity="0.9" />
      <rect x="13" y="36.5" width="11" height="2.6" rx="1.3" fill="#ffffff" opacity="0.5" />
      <rect x="13" y="44" width="9" height="4.4" rx="2.2" fill="#ffffff" />
      <rect x="24.5" y="44" width="9" height="4.4" rx="2.2" fill="#ffffff" />
      <rect x="36" y="44" width="9" height="4.4" rx="2.2" fill="#ffffff" opacity="0.35" />
    </Base>
  )
})

export const IconeComprasPrevistas = memo(function IconeComprasPrevistas({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base className={className} defs={<Grad id={id('e')} de="#6ee7b7" ate="#059669" />}>
      <path d="M18 6 H46 A6 6 0 0 1 52 12 V55 L32 43 L12 55 V12 A6 6 0 0 1 18 6 Z" fill={`url(#${id('e')})`} strokeLinejoin="round" />
      <rect x="16" y="10" width="4" height="26" rx="2" fill="#ffffff" opacity="0.3" />
      <path d="M32 17 V33 M24 25 H40" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" />
    </Base>
  )
})

// ── Listas & Desejos ──────────────────────────────────────────────────────────

export const IconeCoracao = memo(function IconeCoracao({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base className={className} defs={<Grad id={id('r')} de="#f9a8d4" ate="#db2777" />}>
      <path
        d="M32 54 C14 42 6 32 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 32 50 42 32 54 Z"
        fill={`url(#${id('r')})`}
      />
      <ellipse cx="18" cy="18" rx="6" ry="3.6" fill="#ffffff" opacity="0.5" transform="rotate(-35 18 18)" />
      <path d="M53 1 L54.6 5.4 L59 7 L54.6 8.6 L53 13 L51.4 8.6 L47 7 L51.4 5.4 Z" fill="#fbbf24" />
    </Base>
  )
})

export const IconeCesta = memo(function IconeCesta({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('c')} de="#fde68a" ate="#d97706" />
        <Grad id={id('b')} de="#f59e0b" ate="#b45309" />
        <Grad id={id('t')} de="#fca5a5" ate="#ef4444" />
        <Grad id={id('v')} de="#86efac" ate="#16a34a" />
      </>}
    >
      <path d="M17 30 C17 9 47 9 47 30" fill="none" stroke="#b45309" strokeWidth="3.2" strokeLinecap="round" />
      <rect x="38" y="9" width="7" height="24" rx="3.5" fill="#fcd34d" stroke="#d97706" strokeWidth="0.8" transform="rotate(22 41.5 21)" />
      <ellipse cx="31" cy="20" rx="6" ry="11" fill={`url(#${id('v')})`} transform="rotate(-18 31 20)" />
      <circle cx="21" cy="24" r="7.5" fill={`url(#${id('t')})`} />
      <path d="M19 17 Q21 14.5 23.5 16.5" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 31 H56 L51.5 50 A6 6 0 0 1 45.6 55 H18.4 A6 6 0 0 1 12.5 50 Z" fill={`url(#${id('c')})`} />
      <path d="M21 37 V50 M29 37 V51 M37 37 V51 M45 37 V50" stroke="#b45309" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <rect x="5" y="27" width="54" height="7.5" rx="3.75" fill={`url(#${id('b')})`} />
    </Base>
  )
})

export const IconeCoroa = memo(function IconeCoroa({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('o')} de="#fef08a" ate="#f59e0b" />
        <Grad id={id('f')} de="#fbbf24" ate="#d97706" />
      </>}
    >
      <path d="M8 22 L20 33 L32 14 L44 33 L56 22 L51 46 H13 Z" fill={`url(#${id('o')})`} stroke="#d97706" strokeWidth="1" strokeLinejoin="round" />
      <path d="M14 30 L19 35 L16 42" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <rect x="11" y="44" width="42" height="9" rx="3.5" fill={`url(#${id('f')})`} />
      <circle cx="8" cy="21" r="3.8" fill={ROSA} />
      <circle cx="32" cy="12" r="4.2" fill={CIANO} />
      <circle cx="56" cy="21" r="3.8" fill={ROSA} />
      <circle cx="21" cy="48.5" r="2.2" fill={CIANO} />
      <circle cx="32" cy="48.5" r="2.8" fill={ROSA} />
      <circle cx="43" cy="48.5" r="2.2" fill={CIANO} />
    </Base>
  )
})

// ── Relatórios ────────────────────────────────────────────────────────────────

export const IconeRelatorio = memo(function IconeRelatorio({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('s')} de="#7dd3fc" ate="#0284c7" />
      </>}
    >
      <path d="M16 5 H40 L52 17 V52 A4 4 0 0 1 48 56 H16 A4 4 0 0 1 12 52 V9 A4 4 0 0 1 16 5 Z" fill={`url(#${id('b')})`} stroke={CONTORNO} strokeLinejoin="round" />
      <path d="M40 5 V13 A4 4 0 0 0 44 17 H52 Z" fill={CONTORNO} />
      <rect x="18" y="12" width="16" height="4.5" rx="2.25" fill="#0ea5e9" />
      <rect x="18" y="22" width="27" height="2.8" rx="1.4" fill={CONTORNO} />
      <rect x="18" y="27.5" width="20" height="2.8" rx="1.4" fill={CONTORNO} />
      <rect x="18" y="40" width="5.5" height="10" rx="2" fill={`url(#${id('s')})`} />
      <rect x="26" y="35" width="5.5" height="15" rx="2" fill={`url(#${id('s')})`} />
      <rect x="34" y="42" width="5.5" height="8" rx="2" fill={`url(#${id('s')})`} />
      <rect x="42" y="37" width="5.5" height="13" rx="2" fill={CIANO} />
    </Base>
  )
})

export const IconeGrafico = memo(function IconeGrafico({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('v')} de="#c4b5fd" ate="#7c3aed" />
        <Grad id={id('c')} de="#a5f3fc" ate="#06b6d4" />
        <Grad id={id('r')} de="#fbcfe8" ate="#ec4899" />
      </>}
    >
      <rect x="7" y="9" width="50" height="46" rx="13" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <rect x="15" y="31" width="8" height="17" rx="3" fill={`url(#${id('v')})`} />
      <rect x="28" y="19" width="8" height="29" rx="3" fill={`url(#${id('c')})`} />
      <rect x="41" y="26" width="8" height="22" rx="3" fill={`url(#${id('r')})`} />
      <rect x="13" y="48" width="38" height="2.4" rx="1.2" fill={CONTORNO} />
    </Base>
  )
})

// ── Configurações ─────────────────────────────────────────────────────────────

/** Engrenagem de `dentes` dentes centrada em (cx, cy), com vales em arco. */
function caminhoEngrenagem(cx: number, cy: number, rExt: number, rInt: number, dentes: number) {
  const passo = (Math.PI * 2) / dentes
  const base = passo * 0.27
  const topo = passo * 0.17
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  let d = ''
  for (let i = 0; i < dentes; i++) {
    const a = i * passo - Math.PI / 2
    d += i === 0 ? `M${pt(rInt, a - base)}` : ` A${rInt} ${rInt} 0 0 1 ${pt(rInt, a - base)}`
    d += ` L${pt(rExt, a - topo)} L${pt(rExt, a + topo)} L${pt(rInt, a + base)}`
  }
  const a0 = -Math.PI / 2
  return `${d} A${rInt} ${rInt} 0 0 1 ${pt(rInt, a0 - base)} Z`
}

const ENGRENAGEM = caminhoEngrenagem(32, 31, 25, 19.5, 8)

export const IconeEngrenagem = memo(function IconeEngrenagem({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('g')} de="#e2e8f0" ate="#64748b" />
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
      </>}
    >
      <path d={ENGRENAGEM} fill={`url(#${id('g')})`} stroke="#64748b" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="32" cy="31" r="12.5" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <circle cx="32" cy="31" r="7.5" fill={NAVY} />
      <circle cx="32" cy="31" r="3.4" fill={CIANO} />
      <circle cx="30.4" cy="29.4" r="1" fill="#ffffff" opacity="0.85" />
    </Base>
  )
})

// ── Atalhos ───────────────────────────────────────────────────────────────────

export const IconeMicrofone = memo(function IconeMicrofone({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base className={className} defs={<Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />}>
      <path d="M15 29 A17 17 0 0 0 49 29" fill="none" stroke={ARDOSIA} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M32 46 V53" stroke={ARDOSIA} strokeWidth="3.4" strokeLinecap="round" />
      <rect x="22" y="52" width="20" height="4.4" rx="2.2" fill={ARDOSIA} />
      <rect x="21" y="5" width="22" height="34" rx="11" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <rect x="25" y="9" width="14" height="23" rx="7" fill={NAVY} />
      <rect x="28.5" y="14" width="7" height="2.2" rx="1.1" fill={CIANO} />
      <rect x="28.5" y="19.4" width="7" height="2.2" rx="1.1" fill={CIANO} opacity="0.75" />
      <rect x="28.5" y="24.8" width="7" height="2.2" rx="1.1" fill={CIANO} opacity="0.5" />
      <g fill="none" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round">
        <path d="M55 14 Q58.5 20 55 26" />
        <path d="M9 14 Q5.5 20 9 26" />
      </g>
    </Base>
  )
})

export const IconeChecklist = memo(function IconeChecklist({ className }: IconeIlustradoProps) {
  const id = useIds()
  return (
    <Base
      className={className}
      defs={<>
        <Grad id={id('b')} de="#ffffff" ate="#dbe4f3" />
        <Grad id={id('e')} de="#6ee7b7" ate="#10b981" />
      </>}
    >
      <rect x="10" y="9" width="44" height="47" rx="10" fill={`url(#${id('b')})`} stroke={CONTORNO} />
      <rect x="22" y="5" width="20" height="9" rx="4.5" fill={ARDOSIA} />
      <rect x="25" y="7.5" width="14" height="4" rx="2" fill="#e2e8f0" />
      {[22, 33, 44].map((y, i) => (
        <g key={y}>
          <rect x="16" y={y - 4} width="8" height="8" rx="2.6" fill={i < 2 ? `url(#${id('e')})` : CONTORNO} />
          {i < 2 && <path d={`M17.8 ${y} L19.6 ${y + 1.8} L22.4 ${y - 1.6}`} fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
          <rect x="28" y={y - 1.4} width={i === 1 ? 16 : 20} height="2.8" rx="1.4" fill={i < 2 ? ARDOSIA : CONTORNO} opacity={i < 2 ? 0.6 : 1} />
        </g>
      ))}
    </Base>
  )
})
