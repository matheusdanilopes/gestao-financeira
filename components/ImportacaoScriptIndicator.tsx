'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FileSpreadsheet, X } from 'lucide-react'
import { useImportacaoScript } from './ImportacaoScriptProvider'

// Sucesso some sozinho depois de um tempo — erro fica visível até o usuário
// dispensar ou visitar /importar, onde o painel completo assume.
const AUTO_HIDE_SUCESSO_MS = 8000

const ESTILOS: Record<'running' | 'success' | 'error', string> = {
  running: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800/60',
  success: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-100 dark:border-green-800/60',
  error: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-100 dark:border-red-800/60',
}

const TEXTOS: Record<'running' | 'success' | 'error', string> = {
  running: 'Importando…',
  success: 'Importação concluída',
  error: 'Falha na importação',
}

export default function ImportacaoScriptIndicator() {
  const { execucao } = useImportacaoScript()
  const pathname = usePathname()
  const status = execucao?.status
  // Identifica a execução atual — ao mudar (novo disparo/detecção), reabre o
  // indicador mesmo que uma execução anterior tenha sido dispensada. Ajustada
  // durante a renderização (não em efeito) seguindo o padrão do React para
  // "resetar estado quando uma prop muda".
  const execKey = `${status ?? ''}|${execucao?.iniciadoEm ?? ''}|${execucao?.finalizadoEm ?? ''}`
  const [dispensado, setDispensado] = useState(false)
  const [ultimaExecKey, setUltimaExecKey] = useState(execKey)
  if (execKey !== ultimaExecKey) {
    setUltimaExecKey(execKey)
    setDispensado(false)
  }

  useEffect(() => {
    if (status !== 'success') return
    const id = setTimeout(() => setDispensado(true), AUTO_HIDE_SUCESSO_MS)
    return () => clearTimeout(id)
  }, [status, execucao?.finalizadoEm])

  // Na própria tela de importação o painel completo já mostra tudo isso.
  if (pathname === '/importar') return null
  if (dispensado || !status || (status !== 'running' && status !== 'success' && status !== 'error')) return null

  return (
    <Link
      href="/importar"
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border shadow-sm transition-colors ${ESTILOS[status]}`}
    >
      {status === 'running'
        ? <span className="w-3 h-3 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" />
        : <FileSpreadsheet className="w-3 h-3 shrink-0" aria-hidden="true" />}
      <span>{TEXTOS[status]}</span>
      {status !== 'running' && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDispensado(true) }}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Dispensar aviso de importação"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </Link>
  )
}
