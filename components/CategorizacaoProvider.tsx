'use client'

import { createContext, useContext, useState, useCallback } from 'react'

interface CategorizacaoContextType {
  categorizando: boolean
  categorizadoMsg: string | null
  categorizar: () => Promise<void>
  limparMsg: () => void
}

const CategorizacaoContext = createContext<CategorizacaoContextType>({
  categorizando: false,
  categorizadoMsg: null,
  categorizar: async () => {},
  limparMsg: () => {},
})

export function useCategorizacao() {
  return useContext(CategorizacaoContext)
}

export function CategorizacaoProvider({ children }: { children: React.ReactNode }) {
  const [categorizando, setCategorizando] = useState(false)
  const [categorizadoMsg, setCategorizadoMsg] = useState<string | null>(null)

  const categorizar = useCallback(async () => {
    if (categorizando) return
    setCategorizando(true)
    setCategorizadoMsg(null)
    try {
      const res = await fetch('/api/categorizar', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setCategorizadoMsg('Erro: ' + data.error)
      } else if (data.total === 0) {
        setCategorizadoMsg('Todas as transações já estão categorizadas!')
      } else if (data.cotaDiariaEsgotada) {
        setCategorizadoMsg(
          `Cota diária do Gemini esgotada. ${data.categorized} de ${data.total} categorizadas. Tente novamente amanhã.`
        )
      } else if (data.erros?.length) {
        setCategorizadoMsg(`${data.categorized}/${data.total} categorizadas com erros em alguns lotes.`)
      } else {
        setCategorizadoMsg(`${data.categorized} transações categorizadas com IA`)
      }
    } catch {
      setCategorizadoMsg('Erro ao categorizar')
    } finally {
      setCategorizando(false)
    }
  }, [categorizando])

  const limparMsg = useCallback(() => setCategorizadoMsg(null), [])

  return (
    <CategorizacaoContext.Provider value={{ categorizando, categorizadoMsg, categorizar, limparMsg }}>
      {children}
    </CategorizacaoContext.Provider>
  )
}
