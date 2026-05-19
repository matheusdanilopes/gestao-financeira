'use client'

import { useEffect, useState } from 'react'

// Chave usada para persistir estado offline em sessionStorage.
// sessionStorage sobrevive a hard navigations dentro da mesma aba (ao contrário
// de variáveis JS que são destruídas no reload), mas é limpo quando o usuário
// fecha e reabre o app — comportamento correto para estado de sessão.
const SESSION_KEY = 'app-connectivity'

function readInitialOnlineState(): boolean {
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

export function useOnline(): boolean {
  const [isOnline, setIsOnline] = useState(readInitialOnlineState)

  useEffect(() => {
    const handleOnline = () => {
      try { sessionStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
      setIsOnline(true)
    }
    const handleOffline = () => {
      try { sessionStorage.setItem(SESSION_KEY, 'offline') } catch { /* noop */ }
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}
