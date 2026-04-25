'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { startOfMonth, addMonths, format } from 'date-fns'
import { supabase } from '@/lib/supabaseClient'

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
  const [mesAtual, setMes] = useState(() => startOfMonth(new Date()))

  useEffect(() => {
    async function calcularMesInicial() {
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
    }

    calcularMesInicial()
  }, [])

  return (
    <MesContext.Provider value={{ mesAtual, setMesAtual: setMes }}>
      {children}
    </MesContext.Provider>
  )
}
