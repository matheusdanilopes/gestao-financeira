'use client'

import type { ComponentType } from 'react'
import { RoboAvatar } from './RoboAvatar'

/** Mesma assinatura dos ícones do lucide, para entrar onde eles entram (menus, atalhos). */
export type IconeCompativel = ComponentType<{ className?: string; strokeWidth?: number }>

/**
 * O Fin como ícone. O tamanho é fixo por uso (o rosto precisa ser um pouco
 * maior que um ícone de traço para ser legível); da className recebida só a
 * cor é aproveitada — as classes de largura/altura do ícone são descartadas.
 */
export function criarIconeFin(tamanho: number): IconeCompativel {
  function IconeFin({ className = '' }: { className?: string }) {
    const semTamanho = className.split(/\s+/).filter(c => c && !/^(w|h)-/.test(c)).join(' ')
    return <RoboAvatar tamanho={tamanho} className={`-my-1 ${semTamanho}`} />
  }
  IconeFin.displayName = `IconeFin${tamanho}`
  return IconeFin
}
