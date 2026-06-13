'use client'

import { CheckCircle2 } from 'lucide-react'

interface Props {
  resumo: {
    matheus: number
    jeniffer: number
    total: string
  }
}

export default function ImportResumo({ resumo }: Props) {
  return (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-5">
      {/* Cabeçalho de sucesso */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 leading-tight">Importação concluída</p>
          <p className="text-xs text-gray-400 leading-tight">Transações adicionadas com sucesso</p>
        </div>
      </div>

      {/* Grid de responsáveis */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-blue-700 num leading-none">{resumo.matheus}</p>
          <p className="text-xs text-gray-500 mt-1">Matheus</p>
        </div>
        <div className="bg-pink-50 border border-pink-100 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-pink-600 num leading-none">{resumo.jeniffer}</p>
          <p className="text-xs text-gray-500 mt-1">Jeniffer</p>
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
        <span className="text-sm font-medium text-gray-600">Total importado</span>
        <span className="text-base font-bold text-green-700 num">R$ {resumo.total}</span>
      </div>
    </div>
  )
}