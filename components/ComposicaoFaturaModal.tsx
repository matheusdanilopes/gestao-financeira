'use client'

import { X } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { formatBRL } from '@/lib/logger'
import type { TipoGasto } from '@/lib/composicaoFatura'

export interface ComposicaoFaturaDados {
  responsavel: string
  mes: string
  /** Mês da fatura no formato usado pela tela de Compras (YYYY-MM), para o deep link. */
  mesRefFatura: string
  total: number
  existente: number
  novo: number
  assinatura: number
}

interface Props {
  aberto: boolean
  onClose: () => void
  dados: ComposicaoFaturaDados | null
  onVerCompras?: (tipo: TipoGasto) => void
}

// Mesma escala tonal usada na barra da fatura (escuro → claro) por responsável.
const CORES_RESPONSAVEL: Record<string, { existente: string; novo: string; assinatura: string }> = {
  Matheus: { existente: 'bg-blue-800', novo: 'bg-blue-500', assinatura: 'bg-blue-200' },
  Jeniffer: { existente: 'bg-pink-800', novo: 'bg-pink-500', assinatura: 'bg-pink-200' },
  Conjunto: { existente: 'bg-purple-800', novo: 'bg-purple-500', assinatura: 'bg-purple-200' },
}
const CORES_PADRAO = { existente: 'bg-gray-700', novo: 'bg-gray-500', assinatura: 'bg-gray-300' }

const LINHAS = [
  { chave: 'existente' as const, label: 'Parcelas antigas', descricao: 'Parcelas de compras de meses anteriores (2/X em diante)' },
  { chave: 'novo' as const, label: 'Novas compras', descricao: 'Compras novas ou primeira parcela (1/X)' },
  { chave: 'assinatura' as const, label: 'Assinaturas', descricao: 'Cobranças de assinaturas ativas' },
]

export default function ComposicaoFaturaModal({ aberto, onClose, dados, onVerCompras }: Props) {
  if (!aberto || !dados) return null

  const total = dados.total > 0 ? dados.total : 1
  const cores = CORES_RESPONSAVEL[dados.responsavel] ?? CORES_PADRAO

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
            {LINHAS.filter(({ chave }) => dados[chave] > 0).map(({ chave, label, descricao }) => {
              const valor = dados[chave]
              const pct = (valor / total) * 100
              const dot = cores[chave]
              const clicavel = !!onVerCompras && valor > 0
              return (
                <div
                  key={chave}
                  onDoubleClick={clicavel ? () => onVerCompras(chave) : undefined}
                  className={`bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5 border border-gray-100 dark:border-gray-700/50 ${clicavel ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''}`}
                >
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

          {onVerCompras && (
            <p className="text-center text-[11px] text-gray-400 dark:text-gray-500 mt-3">
              Toque duas vezes em um card para ver as compras
            </p>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
