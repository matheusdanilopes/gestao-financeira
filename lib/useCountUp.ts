'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Anima um número do valor anterior até `alvo` (ease-out cúbico) — usado no
 * saldo do Dashboard para o valor "contar" ao carregar ou trocar de mês.
 * Com "reduzir movimento" ativo no sistema, devolve o valor final direto.
 */
export function useCountUp(alvo: number, duracaoMs = 650): number {
  const [valor, setValor] = useState(alvo)
  const atualRef = useRef(alvo)

  useEffect(() => {
    const inicio = atualRef.current
    if (inicio === alvo) return

    const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const duracao = reduzir ? 0 : duracaoMs

    let raf = 0
    const t0 = performance.now()
    const passo = (t: number) => {
      const p = duracao > 0 ? Math.min(1, (t - t0) / duracao) : 1
      const e = 1 - Math.pow(1 - p, 3)
      const v = p < 1 ? inicio + (alvo - inicio) * e : alvo
      atualRef.current = v
      setValor(v)
      if (p < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [alvo, duracaoMs])

  return valor
}
