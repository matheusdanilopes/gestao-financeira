'use client'

import { memo } from 'react'
import Link from 'next/link'
import { ChevronRight, History } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useUltimaImportacao } from '@/lib/useUltimaImportacao'

function formatarData(d: Date): string {
  if (isToday(d)) return `hoje às ${format(d, 'HH:mm')}`
  if (isYesterday(d)) return `ontem às ${format(d, 'HH:mm')}`
  return format(d, "dd 'de' MMM 'às' HH:mm", { locale: ptBR })
}

export default memo(function UltimaImportacaoInfo({
  className = 'text-gray-400 dark:text-gray-500',
  href,
}: {
  className?: string
  /** Quando informado, o texto vira um link (ex.: para a tela de importação). */
  href?: string
}) {
  const { ultimaImportacao, loading } = useUltimaImportacao()

  if (loading || !ultimaImportacao) return null

  const conteudo = (
    <>
      <History className="w-3 h-3 shrink-0" aria-hidden="true" />
      Última importação: {formatarData(ultimaImportacao)}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className={`inline-flex items-center gap-1 text-[11px] mt-0.5 py-1 -my-1 rounded-md hover:underline
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${className}`}
      >
        {conteudo}
        <ChevronRight className="w-3 h-3 shrink-0" aria-hidden="true" />
      </Link>
    )
  }

  return (
    <p className={`flex items-center gap-1 text-[11px] mt-0.5 ${className}`}>
      {conteudo}
    </p>
  )
})
