'use client'

import { useEffect, useState } from 'react'

// Marca no localStorage o instante em que o dispositivo ficou offline.
// localStorage sobrevive a hard navigations E a recargas de PWA na mesma aba,
// ao contrário de variáveis JS ou sessionStorage (que pode ser limpo em alguns
// contextos PWA no Android/iOS durante uma navegação completa de página).
const OFFLINE_KEY = 'app-offline-at'

// Janela de 5 min: se o evento offline disparou há menos de 5 min e o
// window.online ainda não limpou a chave, continuamos em modo offline.
// Cobre o gap entre o hard nav e o novo mount do hook.
const OFFLINE_TTL_MS = 5 * 60 * 1000

function readInitialOnlineState(): boolean {
  if (typeof navigator === 'undefined') return true

  // Sinal inequívoco do OS — sem rede alguma
  if (!navigator.onLine) {
    // Renova o timestamp para que o TTL não expire enquanto ainda offline
    try { localStorage.setItem(OFFLINE_KEY, String(Date.now())) } catch { /* noop */ }
    return false
  }

  // navigator.onLine = true é não confiável no Android/iOS (retorna true quando
  // conectado a Wi-Fi/4G sem internet real). Verifica se o evento window.offline
  // disparou recentemente nesta sessão (persiste através de hard navigations).
  try {
    const raw = localStorage.getItem(OFFLINE_KEY)
    if (raw) {
      const age = Date.now() - parseInt(raw, 10)
      if (age < OFFLINE_TTL_MS) return false // ainda dentro da janela offline
      localStorage.removeItem(OFFLINE_KEY)   // expirado — limpa
    }
  } catch { /* noop */ }

  return true
}

export function useOnline(): boolean {
  const [isOnline, setIsOnline] = useState(readInitialOnlineState)

  useEffect(() => {
    const handleOnline = () => {
      try { localStorage.removeItem(OFFLINE_KEY) } catch { /* noop */ }
      setIsOnline(true)
    }
    const handleOffline = () => {
      try { localStorage.setItem(OFFLINE_KEY, String(Date.now())) } catch { /* noop */ }
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
