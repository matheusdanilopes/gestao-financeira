'use client'

import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useTheme } from '@/components/ThemeProvider'

export function useIsDark(): { isDark: boolean; isDarkRef: MutableRefObject<boolean> } {
  const { theme } = useTheme()
  const [isDark, setIsDark] = useState(false)
  const isDarkRef = useRef(false)

  useEffect(() => {
    const sync = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      setIsDark(dark)
      isDarkRef.current = dark
    }
    sync()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [theme])

  return { isDark, isDarkRef }
}
