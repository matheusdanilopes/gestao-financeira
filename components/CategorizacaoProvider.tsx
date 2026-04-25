'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'

interface JobStatus {
  status: 'running' | 'done' | 'idle'
  total?: number
  categorized?: number
  cota_diaria_esgotada?: boolean
  erros?: string[]
  started_at?: string
  finished_at?: string
}

interface CategorizacaoContextType {
  categorizando: boolean
  categorizadoMsg: string | null
  categorizar: () => void
  limparMsg: () => void
}

const CategorizacaoContext = createContext<CategorizacaoContextType>({
  categorizando: false,
  categorizadoMsg: null,
  categorizar: () => {},
  limparMsg: () => {},
})

export function useCategorizacao() {
  return useContext(CategorizacaoContext)
}

function buildMsg(job: JobStatus): string | null {
  if (job.total === 0) return 'Todas as transações já estão categorizadas!'
  if (job.cota_diaria_esgotada) {
    return `Cota diária do Gemini esgotada. ${job.categorized} de ${job.total} categorizadas. Tente novamente amanhã.`
  }
  if (job.erros?.length) {
    return `${job.categorized}/${job.total} categorizadas com erros em alguns lotes.`
  }
  return `${job.categorized} transações categorizadas com IA`
}

const POLL_INTERVAL_MS = 3_000
const MAX_POLL_MS = 10 * 60 * 1_000
const RECENT_RESULT_MS = 2 * 60 * 1_000

export function CategorizacaoProvider({ children }: { children: React.ReactNode }) {
  const [categorizando, setCategorizando] = useState(false)
  const [categorizadoMsg, setCategorizadoMsg] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (timerRef.current !== null) return
    pollStartRef.current = Date.now()

    timerRef.current = setInterval(async () => {
      if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
        stopPolling()
        setCategorizando(false)
        return
      }
      try {
        const res = await fetch('/api/categorizar/status')
        if (!res.ok) return
        const job: JobStatus = await res.json()
        if (job.status === 'done') {
          stopPolling()
          setCategorizando(false)
          setCategorizadoMsg(buildMsg(job))
        } else if (job.status === 'idle' && Date.now() - pollStartRef.current > 30_000) {
          stopPolling()
          setCategorizando(false)
        }
      } catch { /* mantém polling em caso de erro de rede */ }
    }, POLL_INTERVAL_MS)
  }, [stopPolling])

  // Ao montar (ou reabrir o app): verifica se há job em andamento ou recém-concluído
  useEffect(() => {
    async function checkOnMount() {
      try {
        const res = await fetch('/api/categorizar/status')
        if (!res.ok) return
        const job: JobStatus = await res.json()
        if (job.status === 'running') {
          setCategorizando(true)
          startPolling()
        } else if (job.status === 'done' && job.finished_at) {
          const age = Date.now() - new Date(job.finished_at).getTime()
          if (age < RECENT_RESULT_MS) {
            setCategorizadoMsg(buildMsg(job))
          }
        }
      } catch { /* silencioso */ }
    }
    checkOnMount()
    return stopPolling
  }, [startPolling, stopPolling])

  const categorizar = useCallback(() => {
    if (categorizando) return
    setCategorizando(true)
    setCategorizadoMsg(null)
    // Fire-and-forget: servidor continua mesmo se o app for fechado
    fetch('/api/categorizar', { method: 'POST' }).catch(() => {})
    startPolling()
  }, [categorizando, startPolling])

  const limparMsg = useCallback(() => setCategorizadoMsg(null), [])

  return (
    <CategorizacaoContext.Provider value={{ categorizando, categorizadoMsg, categorizar, limparMsg }}>
      {children}
    </CategorizacaoContext.Provider>
  )
}
