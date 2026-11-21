'use client'

import { useEffect, useState } from 'react'

/**
 * Busca um JSON público (cotações, notícias) e guarda a última resposta no
 * aparelho: ao abrir o app a faixa aparece na hora com o valor anterior e é
 * atualizada em seguida. Falhas mantêm o que já havia (ou nada).
 */
export function useJsonPublico<T>(url: string, chave: string, atualizarMs: number): T | null {
  const [dados, setDados] = useState<T | null>(null)

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(chave)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (salvo) setDados(JSON.parse(salvo) as T)
    } catch { /* storage indisponível */ }

    let vivo = true
    const buscar = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const json = (await res.json()) as T
        if (!vivo) return
        setDados(json)
        try { localStorage.setItem(chave, JSON.stringify(json)) } catch { /* ignora */ }
      } catch { /* rede: mantém o anterior */ }
    }
    buscar()
    const t = setInterval(buscar, atualizarMs)
    return () => { vivo = false; clearInterval(t) }
  }, [url, chave, atualizarMs])

  return dados
}
