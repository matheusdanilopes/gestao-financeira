'use client'

import { useSyncExternalStore } from 'react'

// Chave usada para persistir estado offline em sessionStorage.
// sessionStorage sobrevive a hard navigations dentro da mesma aba (ao contrário
// de variáveis JS que são destruídas no reload), mas é limpo quando o usuário
// fecha e reabre o app — comportamento correto para estado de sessão.
const SESSION_KEY = 'app-connectivity'

function readOnlineState(): boolean {
  if (typeof navigator === 'undefined') return true
  // Se o OS já sabe que está offline, confia nele imediatamente
  if (!navigator.onLine) return false
  // Verifica se o evento window.offline já tinha disparado antes de um hard nav
  // (navigator.onLine é notoriamente não confiável em Android/iOS quando o
  // dispositivo está conectado a uma rede sem internet real)
  try {
    return sessionStorage.getItem(SESSION_KEY) !== 'offline'
  } catch {
    return true
  }
}

// Snapshot em cache: getSnapshot é chamado a cada render de cada consumidor e
// precisa ser barato e estável — ler sessionStorage toda vez seria desperdício.
// Só os eventos online/offline invalidam o valor.
let _snapshot: boolean | null = null

function getSnapshot(): boolean {
  if (_snapshot === null) _snapshot = readOnlineState()
  return _snapshot
}

// No servidor sempre assumimos online. Isso mantém o HTML renderizado no
// servidor igual ao primeiro render do cliente: o React hidrata com este
// snapshot e só depois reconcilia com o estado real, sem erro de hidratação
// (que faria o React descartar e re-renderizar a árvore inteira no cliente —
// justamente o tipo de falha que já deixou a barra inferior sumir no iOS).
function getServerSnapshot(): boolean {
  return true
}

function subscribe(onStoreChange: () => void): () => void {
  const handleOnline = () => {
    try { sessionStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
    _snapshot = true
    onStoreChange()
  }
  const handleOffline = () => {
    try { sessionStorage.setItem(SESSION_KEY, 'offline') } catch { /* noop */ }
    _snapshot = false
    onStoreChange()
  }
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
