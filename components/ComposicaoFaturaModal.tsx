'use client'

import { X } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { formatBRL } from '@/lib/logger'

export interface ComposicaoFaturaDados {
  responsavel: string
  mes: string
  total: number
  existente: number
  novo: number
  assinatura: number
}

interface Props {
  aberto: boolean
  onClose: () => void
  dados: ComposicaoFaturaDados | null
}

const LINHAS = [
  { chave: 'existente' as const, label: 'Parcelas antigas', descricao: 'Parcelas de compras de meses anteriores (2/X em diante)', dot: 'bg-gray-500 dark:bg-gray-300' },
  { chave: 'novo' as const, label: 'Novas parcelas', descricao: 'Compras novas ou primeira parcela (1/X)', dot: 'bg-amber-400' },
  { chave: 'assinatura' as const, label: 'Assinaturas', descricao: 'Cobranças de assinaturas ativas', dot: 'bg-emerald-400' },
]

export default function ComposicaoFaturaModal({ aberto, onClose, dados }: Props) {
  if (!aberto || !dados) return null

  const total = dados.total > 0 ? dados.total : 1

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[190] modal-overlay" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-3xl shadow-float z-[200] max-h-[84vh] overflow-y-auto modal-sheet">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div className="px-4 pb-6 pt-1">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">
                Composição da fatura — {dados.responsavel}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{dados.mes}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors active:scale-90"
              aria-label="Fechar"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <div className="bg-primary-50 dark:bg-primary-900/20 rounded-2xl p-4 mb-4 border border-primary-100 dark:border-primary-900/40">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Valor gasto</p>
            <p className="text-2xl font-bold text-primary-700 dark:text-primary-300 num tracking-tight">
              {formatBRL(dados.total)}
            </p>
          </div>

          <div className="space-y-2.5">
            {LINHAS.map(({ chave, label, descricao, dot }) => {
              const valor = dados[chave]
              const pct = (valor / total) * 100
              return (
                <div key={chave} className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5 border border-gray-100 dark:border-gray-700/50">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                      {label}
                    </span>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 num">{formatBRL(valor)}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{descricao}</p>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${dot}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
