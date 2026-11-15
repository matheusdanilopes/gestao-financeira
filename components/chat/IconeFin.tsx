'use client'

import type { ComponentType } from 'react'
import { RoboAvatar } from './RoboAvatar'

/** Mesma assinatura dos ícones do lucide, para entrar onde eles entram (menus, atalhos). */
export type IconeCompativel = ComponentType<{ className?: string; strokeWidth?: number }>

/**
 * O Fin como ícone, no mesmo molde dos ícones ilustrados da navegação
 * (components/icones/IconesIlustrados.tsx): o tamanho vem das classes w-/h-
 * da className, que sobrepõem o width/height do SVG.
 */
export function IconeFin({ className = '' }: { className?: string; strokeWidth?: number }) {
  return <RoboAvatar tamanho={24} className={className} />
}
