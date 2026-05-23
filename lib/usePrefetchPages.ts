'use client'

import { useEffect } from 'react'
import { format, startOfMonth, addMonths } from 'date-fns'
import {
  prefetchSaldo,
  prefetchCompras,
  prefetchChecklist,
  prefetchReceitas,
  prefetchInvestimentos,
  prefetchAssinaturas,
} from '@/lib/prefetchers'

function warmCache(key: string, fetcher: () => Promise<unknown>) {
  const storageKey = `datasync:${key}`
  if (localStorage.getItem(storageKey)) return
  fetcher()
    .then(data => {
      try {
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, JSON.stringify({ data, ts: Date.now() }))
        }
      } catch { /* quota exceeded */ }
    })
    .catch(() => { /* background-only */ })
}

/**
 * Pre-warms the localStorage cache for all main pages (Finanças, Compras,
 * Checklist, Receitas, Investimentos, Assinaturas) using idle-time fetches.
 * Call this from the Dashboard — it fires after the initial data is loaded
 * so it never competes with critical path requests.
 */
export function usePrefetchPages(mesAtual: Date, isOnline: boolean) {
  useEffect(() => {
    if (!isOnline) return

    const mesRef        = startOfMonth(mesAtual)
    const mesRefStr     = format(mesRef, 'yyyy-MM-dd')
    const nextMesRefStr = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')
    const mesYYYYMM     = format(mesRef, 'yyyy-MM')

    const tasks = [
      () => warmCache(`investimentos-saldo:${mesYYYYMM}`,  () => prefetchSaldo(mesAtual)),
      () => warmCache(`compras:${nextMesRefStr}`,           () => prefetchCompras(nextMesRefStr)),
      () => warmCache(`checklist:${mesRefStr}`,             () => prefetchChecklist(mesRefStr)),
      () => warmCache(`receitas:${mesRefStr}`,              () => prefetchReceitas(mesRefStr)),
      () => warmCache(`investimentos:${mesRefStr}`,         () => prefetchInvestimentos(mesRefStr)),
      () => warmCache(`assinaturas:${mesRefStr}`,           () => prefetchAssinaturas(mesRefStr, nextMesRefStr)),
    ]

    if ('requestIdleCallback' in window) {
      const ids = tasks.map((task, i) =>
        requestIdleCallback(task, { timeout: 5000 + i * 1000 })
      )
      return () => ids.forEach(id => cancelIdleCallback(id))
    }

    // Fallback for Safari (no requestIdleCallback)
    const timers = tasks.map((task, i) => setTimeout(task, 3000 + i * 800))
    return () => timers.forEach(t => clearTimeout(t))
  }, [mesAtual, isOnline])
}
