'use client'

/**
 * Preferência "Hey Gestor" (ligado/desligado), compartilhada entre a tela de
 * Configurações (onde o usuário liga/desliga) e o listener global (que
 * decide se escuta em segundo plano) sem precisar de um Context — os dois
 * ficam bem longe um do outro na árvore de componentes para valer a pena.
 */

import { useSyncExternalStore } from 'react'

const CHAVE = 'hey_gestor_ativo'
let ativo = false
let carregado = false
const ouvintes = new Set<() => void>()

function carregar(): void {
  if (carregado) return
  carregado = true
  try { ativo = localStorage.getItem(CHAVE) === '1' } catch { /* storage indisponível */ }
}

export function heyGestorAtivo(): boolean {
  carregar()
  return ativo
}

export function setHeyGestorAtivo(valor: boolean): void {
  carregar()
  if (ativo === valor) return
  ativo = valor
  try { localStorage.setItem(CHAVE, valor ? '1' : '0') } catch { /* storage indisponível */ }
  ouvintes.forEach(fn => fn())
}

function aoMudar(fn: () => void): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}

const snapshotServidor = () => false

export function useHeyGestorAtivo(): [boolean, (valor: boolean) => void] {
  const valor = useSyncExternalStore(aoMudar, heyGestorAtivo, snapshotServidor)
  return [valor, setHeyGestorAtivo]
}
