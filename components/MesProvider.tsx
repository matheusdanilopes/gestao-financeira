'use client'

import { createContext, useContext, useState } from 'react'
import { startOfMonth } from 'date-fns'

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
  return (
    <MesContext.Provider value={{ mesAtual, setMesAtual: setMes }}>
      {children}
    </MesContext.Provider>
  )
}
