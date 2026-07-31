'use client'

import { CreditCard, Layers, Calendar } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import ModalPortal from '@/components/ModalPortal'
import { formatBRL } from '@/lib/logger'
import type { AlertasFaturaResponse } from '@/app/api/alertas-fatura/route'

interface Props {
  aberto: boolean
  dados: AlertasFaturaResponse | null
  onFechar: () => void
}

const NIVEL_BADGE: Record<string, { cls: string; label: string }> = {
  alerta: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300', label: 'Atenção' },
}

function corBarra(pct: number): string {
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-400'
  return 'bg-emerald-500'
}

function corTexto(pct: number): string {
  if (pct >= 100) return '#ef4444'
  if (pct >= 80) return '#f59e0b'
  return '#6b7280'
}

function BarraProgresso({ pct }: { pct: number }) {
  return (
    <div
      className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(Math.min(pct, 100))}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${corBarra(pct)}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  )
}

function formatarDia(iso: string): string {
  const d = parseISO(iso)
  const dia = format(d, 'dd/MM')
  const semana = format(d, 'EEEE', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())
  return `${dia} (${semana})`
}

export default function AlertaFaturaModal({ aberto, dados, onFechar }: Props) {
  if (!aberto || !dados) return null

  const { parcelamento, fatura, insights } = dados

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[250] modal-overlay flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-gray-900 rounded-3xl shadow-float w-full max-w-sm max-h-[85vh] overflow-y-auto modal-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alerta-fatura-titulo"
        >
          <div className="p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
                <CreditCard className="w-4.5 h-4.5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 id="alerta-fatura-titulo" className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">
                  Resumo do cartão
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Fatura NuBank</p>
              </div>
            </div>

            {/* Bloco parcelamento */}
            {parcelamento.percentual !== null && (
              <div className="mb-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Layers className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Parcelamento
                  </p>
                </div>
                <p className="text-xl font-bold text-gray-800 dark:text-gray-100 num mb-1.5">
                  {Math.round(parcelamento.percentual)}% do limite usado
                </p>
                <BarraProgresso pct={parcelamento.percentual} />
                <p className="text-[11px] text-right mt-1 font-semibold" style={{ color: corTexto(parcelamento.percentual) }}>
                  {parcelamento.falta < 0
                    ? `Limite ultrapassado em ${formatBRL(Math.abs(parcelamento.falta))}`
                    : `Ainda pode comprometer ${formatBRL(parcelamento.falta)}`}
                </p>
              </div>
            )}

            {/* Bloco fatura */}
            <div className="mb-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Calendar className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Fatura atual
                </p>
              </div>
              {fatura.percentual !== null && (
                <>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 num mb-1.5">
                    {Math.round(fatura.percentual)}% gasto
                  </p>
                  <BarraProgresso pct={fatura.percentual} />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 num">
                    {formatBRL(fatura.gasto)} de {formatBRL(fatura.previsto)} previsto
                  </p>
                </>
              )}
              <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700/60">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Fecha em <span className="font-semibold text-gray-700 dark:text-gray-300">{Math.max(fatura.diasAteFechar, 0)} dias</span>
                </span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{formatarDia(fatura.dataFechamento)}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Vence em <span className="font-semibold text-gray-700 dark:text-gray-300">{Math.max(fatura.diasAteVencimento, 0)} dias</span>
                </span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{formatarDia(fatura.dataVencimento)}</span>
              </div>
            </div>

            {/* Insights de atenção */}
            {insights.length > 0 && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Pontos de atenção
                </p>
                <div className="space-y-2">
                  {insights.map((item, i) => (
                    <div
                      key={i}
                      className="flex gap-2.5 rounded-2xl border border-amber-100 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10 p-3"
                    >
                      <span className="text-lg leading-none shrink-0">{item.icone}</span>
                      <div className="min-w-0">
                        <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-px rounded-md mb-0.5 ${NIVEL_BADGE.alerta.cls}`}>
                          {NIVEL_BADGE.alerta.label}
                        </span>
                        <p className="text-[13px] font-bold text-gray-800 dark:text-gray-100 leading-snug">{item.titulo}</p>
                        {item.detalhe && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mt-0.5">{item.detalhe}</p>
                        )}
                        {item.recomendacao && (
                          <p className="text-[11px] mt-1 font-medium text-amber-600 dark:text-amber-400">→ {item.recomendacao}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={onFechar}
              autoFocus
              className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-2xl active:scale-[0.98] transition-all"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
