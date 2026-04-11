'use client'

import { X } from 'lucide-react'

interface Props {
  aberto: boolean
  onClose: () => void
  dados: {
    serie: string
    mes: string
    valor: number
    itens: any[]
  } | null
}

export default function DrawerDetalhes({ aberto, onClose, dados }: Props) {
  if (!aberto || !dados) return null

  return (
    <>
      {/* Overlay escuro */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer que sobe de baixo */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl z-50 transform transition-transform duration-300 max-h-[70vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold">{dados.serie}</h3>
            <p className="text-sm text-gray-500">{dados.mes}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="bg-blue-50 rounded-lg p-3 mb-4">
            <p className="text-sm text-gray-600">Valor total</p>
            <p className="text-2xl font-bold text-blue-600">R$ {dados.valor.toFixed(2)}</p>
          </div>
          
          <h4 className="font-semibold mb-2">Itens que compõem este valor:</h4>
          
          {dados.itens && dados.itens.length > 0 ? (
            <div className="space-y-2">
              {dados.itens.map((item, index) => (
                <div key={index} className="bg-gray-50 rounded-lg p-3">
                  <p className="font-medium">{item.descricao || item.item}</p>
                  <p className="text-sm text-gray-500">
                    {item.responsavel && `Responsável: ${item.responsavel}`}
                  </p>
                  <p className="text-sm font-semibold text-green-600">
                    R$ {item.valor?.toFixed(2) || item.valor_previsto?.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Nenhum detalhe disponível para este ponto.</p>
          )}
        </div>
      </div>
    </>
  )
}