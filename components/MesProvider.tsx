'use client'

import { createContext, startTransition, useCallback, useContext, useEffect, useState } from 'react'
import { startOfMonth, addMonths, format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabaseClient'

const STORAGE_KEY = 'gestao:periodo'

function readPersistedPeriod(): Date | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return null
    return startOfMonth(parseISO(saved + '-01'))
  } catch {
    return null
  }
}

interface MesContextType {
  mesAtual: Date
  setMesAtual: (mes: Date) => void
}

const MesContext = createContext<MesContextType>({
  mesAtual: startOfMonth(new Date()),
  setMesAtual: () => {},
})

export function useMes() {
  return useContext(MesContext)
}

export function MesProvider({ children }: { children: React.ReactNode }) {
  const [mesAtual, setMes] = useState(() => readPersistedPeriod() ?? startOfMonth(new Date()))

  useEffect(() => {
    // Skip auto-advance if user already selected a period manually
    if (readPersistedPeriod() !== null) return

    async function calcularMesInicial() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return

      try {
        const mesRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')
        const { data: planejamento } = await supabase
          .from('planejamento')
          .select('valor_previsto, pago, valor_real, item')
          .eq('mes_referencia', mesRef)

        if (!planejamento || planejamento.length === 0) return

        const despesas = planejamento.filter(p => {
          const item = typeof p.item === 'string' ? p.item : ''
          return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
        })

        const totalDespesas = despesas.reduce((acc, p) => acc + (p.valor_previsto || 0), 0)
        if (totalDespesas === 0) return

        const totalPago = despesas
          .filter(p => p.pago)
          .reduce((acc, p) => acc + (p.valor_real ?? p.valor_previsto ?? 0), 0)

        if (totalPago / totalDespesas >= 0.95) {
          setMes(startOfMonth(addMonths(new Date(), 1)))
        }
      } catch {
        // silencioso: período permanece no mês atual
      }
    }

    // Atrasa a verificação para não competir com o fetch crítico do dashboard
    const timer = setTimeout(calcularMesInicial, 300)
    return () => clearTimeout(timer)
  }, [])

  const setMesAtual = useCallback((mes: Date) => {
    const normalized = startOfMonth(mes)
    try { localStorage.setItem(STORAGE_KEY, format(normalized, 'yyyy-MM')) } catch {}
    startTransition(() => setMes(normalized))
  }, [])

  return (
    <MesContext.Provider value={{ mesAtual, setMesAtual }}>
      {children}
    </MesContext.Provider>
  )
}
