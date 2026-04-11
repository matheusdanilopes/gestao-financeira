'use client'

import { CheckCircle } from 'lucide-react'

interface Props {
  resumo: {
    matheus: number
    jeniffer: number
    total: string
  }
}

export default function ImportResumo({ resumo }: Props) {
  return (
    <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle className="w-5 h-5 text-green-600" />
        <h3 className="font-semibold text-green-800">Importação concluída!</h3>
      </div>
      
      <div className="space-y-2 text-sm">
        <p className="flex justify-between">
          <span className="text-gray-600">Novos gastos de Matheus:</span>
          <span className="font-semibold">{resumo.matheus}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-gray-600">Novos gastos de Jeniffer:</span>
          <span className="font-semibold">{resumo.jeniffer}</span>
        </p>
        <p className="flex justify-between border-t border-green-200 pt-2 mt-2">
          <span className="text-gray-700 font-medium">Total importado:</span>
          <span className="font-bold text-green-700">R$ {resumo.total}</span>
        </p>
      </div>
    </div>
  )
}