'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabaseClient'
import { AUTH_DISABLED } from '@/lib/authConfig'
import AlertaFaturaModal from '@/components/AlertaFaturaModal'
import type { AlertasFaturaResponse } from '@/app/api/alertas-fatura/route'

const ESTADO_KEY = 'alerta_fatura_estado_dia'
const JANELA_MS = 4 * 60 * 60 * 1000 // 4h após a primeira exibição do dia
const POLL_MS = 5 * 60 * 1000 // checagem periódica leve enquanto o app está aberto

interface EstadoDia {
  data: string // yyyy-MM-dd
  primeiraExibicao: number // epoch ms
  exibidoApos4h: boolean
}

function lerEstado(): EstadoDia | null {
  try {
    const raw = localStorage.getItem(ESTADO_KEY)
    if (!raw) return null
    return JSON.parse(raw) as EstadoDia
  } catch {
    return null
  }
}

function salvarEstado(estado: EstadoDia): void {
  try { localStorage.setItem(ESTADO_KEY, JSON.stringify(estado)) } catch { /* localStorage indisponível — sem crash */ }
}

// Decide se deve mostrar agora e, em caso positivo, o novo estado a persistir.
function decidirExibicao(): EstadoDia | null {
  const hoje = format(new Date(), 'yyyy-MM-dd')
  const estado = lerEstado()

  if (!estado || estado.data !== hoje) {
    return { data: hoje, primeiraExibicao: Date.now(), exibidoApos4h: false }
  }
  if (!estado.exibidoApos4h && Date.now() - estado.primeiraExibicao >= JANELA_MS) {
    return { ...estado, exibidoApos4h: true }
  }
  return null
}

export default function AlertaFaturaController() {
  const pathname = usePathname()
  const [aberto, setAberto] = useState(false)
  const [dados, setDados] = useState<AlertasFaturaResponse | null>(null)
  const abertoRef = useRef(false)
  const verificandoRef = useRef(false)

  const verificar = useCallback(async () => {
    if (abertoRef.current || verificandoRef.current) return

    const novoEstado = decidirExibicao()
    if (!novoEstado) return

    if (!AUTH_DISABLED) {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
    }

    verificandoRef.current = true
    try {
      const res = await fetch('/api/alertas-fatura', { credentials: 'include' })
      if (!res.ok) return
      const json: AlertasFaturaResponse = await res.json()

      salvarEstado(novoEstado)
      setDados(json)
      setAberto(true)
      abertoRef.current = true
    } catch {
      // falha silenciosa — tenta de novo na próxima checagem
    } finally {
      verificandoRef.current = false
    }
  }, [])

  useEffect(() => {
    if (pathname === '/login') return
    verificar()
  }, [pathname, verificar])

  useEffect(() => {
    if (pathname === '/login') return

    function handleVisibility() {
      if (document.visibilityState === 'visible') verificar()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const interval = setInterval(verificar, POLL_MS)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(interval)
    }
  }, [pathname, verificar])

  if (pathname === '/login') return null

  function fechar() {
    setAberto(false)
    abertoRef.current = false
  }

  return <AlertaFaturaModal aberto={aberto} dados={dados} onFechar={fechar} />
}
