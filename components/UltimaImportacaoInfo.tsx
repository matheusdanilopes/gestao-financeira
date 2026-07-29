'use client'

import { memo } from 'react'
import { History } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useUltimaImportacao } from '@/lib/useUltimaImportacao'

function formatarData(d: Date): string {
  if (isToday(d)) return `hoje às ${format(d, 'HH:mm')}`
  if (isYesterday(d)) return `ontem às ${format(d, 'HH:mm')}`
  return format(d, "dd 'de' MMM 'às' HH:mm", { locale: ptBR })
}

export default memo(function UltimaImportacaoInfo() {
  const { ultimaImportacao, loading } = useUltimaImportacao()

  if (loading || !ultimaImportacao) return null

  return (
    <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
      <History className="w-3 h-3 shrink-0" aria-hidden="true" />
      Última importação: {formatarData(ultimaImportacao)}
    </p>
  )
})
