'use client'

/**
 * Monta o "Hey Gestor" globalmente (ver ClientShell). A própria escuta é
 * opt-in (lib/heyGestorStore.ts, ligada em Configurações) e o hook já ignora
 * tudo quando o navegador não suporta ou a preferência está desligada — este
 * componente só decide EM QUAIS ROTAS ela pode rodar.
 */

import { usePathname, useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { useWakeWord } from '@/lib/useWakeWord'

/** Sem sessão nesta rota — nada para o "Hey Gestor" fazer aqui. */
const ROTAS_SEM_ESCUTA = ['/login']

export default function WakeWordListener() {
  const pathname = usePathname()
  const router = useRouter()

  const habilitado = pathname ? !ROTAS_SEM_ESCUTA.includes(pathname) : false

  const onDetectado = useCallback(() => {
    // /chat já sabe interpretar ?voz=1 como "chegue ouvindo" (mesmo atalho
    // usado pelo botão de voz do FAB) — reaproveita todo o fluxo existente
    // em vez de duplicar a captura da pergunta aqui.
    router.push('/chat?voz=1')
  }, [router])

  useWakeWord({ habilitado, onDetectado })

  return null
}
