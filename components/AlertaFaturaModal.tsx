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

// Reaproveita os tokens de marca já usados em ParcelamentosMensal.tsx/ComposicaoFaturaModal.tsx.
const RESPONSAVEL_TEXTO: Record<string, string> = {
  Matheus: 'text-matheus dark:text-blue-400',
  Jeniffer: 'text-jeniffer dark:text-pink-400',
  Conjunto: 'text-slate-500 dark:text-slate-400',
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

function LinhaResponsavel({
  responsavel,
  percentual,
  valor,
  destaque,
}: {
  responsavel: string
  percentual: number | null
  valor: string
  destaque: boolean
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[11px] font-semibold ${RESPONSAVEL_TEXTO[responsavel] ?? 'text-gray-500'}`}>
        {responsavel}{destaque && <span className="text-gray-400 dark:text-gray-500 font-normal"> (você)</span>}
      </span>
      <span
        className="text-[11px] num"
        style={{ color: percentual !== null ? corTexto(percentual) : undefined }}
      >
        {percentual !== null ? `${Math.round(percentual)}% · ` : ''}
        <span className="text-gray-500 dark:text-gray-400">{valor}</span>
      </span>
    </div>
  )
}

export default function AlertaFaturaModal({ aberto, dados, onFechar }: Props) {
  if (!aberto || !dados) return null

  const { parcelamento, fatura, proximoMes } = dados
  // porResponsavel já vem ordenado com o usuário logado primeiro (ver app/api/alertas-fatura/route.ts).
  const responsavelAtual = parcelamento.porResponsavel[0]?.responsavel ?? fatura.porResponsavel[0]?.responsavel

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
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Fatura NuBank
                  {proximoMes && (
                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-[10px] font-semibold align-middle">
                      Próximo mês
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Bloco parcelamento — sempre visível para deixar claro que o recurso existe,
                mesmo sem limite configurado ou sem parcelas ativas no mês. */}
            <div className="mb-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Layers className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Parcelamento
                </p>
              </div>
              {parcelamento.percentual !== null ? (
                <>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 num mb-1.5">
                    {Math.round(parcelamento.percentual)}% do limite usado
                  </p>
                  <BarraProgresso pct={parcelamento.percentual} />
                  <p className="text-[11px] text-right mt-1 font-semibold" style={{ color: corTexto(parcelamento.percentual) }}>
                    {parcelamento.falta < 0
                      ? `Limite ultrapassado em ${formatBRL(Math.abs(parcelamento.falta))}`
                      : `Ainda pode comprometer ${formatBRL(parcelamento.falta)}`}
                  </p>
                </>
              ) : parcelamento.comprometido > 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatBRL(parcelamento.comprometido)} em parcelas ativas — nenhum limite configurado em Parcelamentos
                </p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma parcela ativa este mês</p>
              )}
              {parcelamento.porResponsavel.some(r => r.limite > 0 || r.comprometido > 0) && (
                <div className="mt-2.5 pt-2 border-t border-gray-100 dark:border-gray-700/60">
                  {parcelamento.porResponsavel
                    .filter(r => r.limite > 0 || r.comprometido > 0)
                    .map(r => (
                      <LinhaResponsavel
                        key={r.responsavel}
                        responsavel={r.responsavel}
                        percentual={r.percentual}
                        valor={formatBRL(r.comprometido)}
                        destaque={r.responsavel === responsavelAtual}
                      />
                    ))}
                </div>
              )}
            </div>

            {/* Bloco fatura */}
            <div className="mb-5 bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Calendar className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {proximoMes ? 'Próxima fatura' : 'Fatura atual'}
                </p>
              </div>
              {fatura.percentual !== null ? (
                <>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 num mb-1.5">
                    {Math.round(fatura.percentual)}% gasto
                  </p>
                  <BarraProgresso pct={fatura.percentual} />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 num">
                    {formatBRL(fatura.gasto)} de {formatBRL(fatura.previsto)} previsto
                  </p>
                </>
              ) : fatura.gasto > 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatBRL(fatura.gasto)} lançado — sem valor previsto configurado
                </p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Nenhum lançamento nesta fatura ainda</p>
              )}
              {fatura.porResponsavel.some(r => r.previsto > 0 || r.gasto > 0) && (
                <div className="mt-2.5 pt-2 border-t border-gray-100 dark:border-gray-700/60">
                  {fatura.porResponsavel
                    .filter(r => r.previsto > 0 || r.gasto > 0)
                    .map(r => (
                      <LinhaResponsavel
                        key={r.responsavel}
                        responsavel={r.responsavel}
                        percentual={r.percentual}
                        valor={formatBRL(r.gasto)}
                        destaque={r.responsavel === responsavelAtual}
                      />
                    ))}
                </div>
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
