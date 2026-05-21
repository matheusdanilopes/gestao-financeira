'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

const TRANSITION_MS = 320

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Carrega preferência do localStorage no mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme') as Theme | null
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeState(stored)
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeState('dark')
      }
    } catch {
      // localStorage indisponível
    }
  }, [])

  // Aplica dark class e escuta mudanças do sistema
  useEffect(() => {
    const root = document.documentElement

    function applyTheme() {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', isDark)
    }

    applyTheme()

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', applyTheme)
      return () => mq.removeEventListener('change', applyTheme)
    }
  }, [theme])

  function setTheme(t: Theme) {
    // Ativa a transição de cores apenas durante a troca de tema
    const body = document.body
    body.classList.add('theme-transition')
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    transitionTimerRef.current = setTimeout(() => {
      body.classList.remove('theme-transition')
    }, TRANSITION_MS)

    setThemeState(t)
    try {
      localStorage.setItem('theme', t)
    } catch {
      // localStorage indisponível
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
