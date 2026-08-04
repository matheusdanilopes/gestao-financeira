'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Calculator, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import { resolverLimiteEfetivo, type LimiteParcelamentoRow } from '@/lib/limitesParcelamentos'
import { RESPONSAVEIS, RESPONSAVEL_STYLE, type Responsavel } from '@/lib/responsavelStyle'
import type { RelatorioCartoes, MesGasto } from '@/lib/relatorioCartoes'

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatarMes(mes: Date): string {
  return capitalizar(format(mes, 'MMM/yyyy', { locale: ptBR }))
}

function valorPorResponsavel(mesGasto: MesGasto, responsavel: Responsavel): number {
  if (responsavel === 'Matheus') return mesGasto.matheus
  if (responsavel === 'Jeniffer') return mesGasto.jeniffer
  return mesGasto.conjunto
}

const MAX_PARCELAS_SUGESTAO = 24

interface MesSimulado {
  mes: string
  baseline: number
  comExtra: number
  limite: number | null
  estoura: boolean
}

interface Props {
  relatorio: RelatorioCartoes | null
}

const CAMPO_FOCO = 'focus-within:border-primary-400 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:focus-within:shadow-[0_0_0_3px_rgba(129,140,248,0.18)] transition-shadow'

export default function SimuladorParcelamento({ relatorio }: Props) {
  const [expandido, setExpandido] = useState(false)
  const [limites, setLimites] = useState<LimiteParcelamentoRow[] | null>(null)
  const [limitesHorizon, setLimitesHorizon] = useState<string | null>(null)

  const [valorStr, setValorStr] = useState('')
  const [parcelasStr, setParcelasStr] = useState('2')
  const [responsavel, setResponsavel] = useState<Responsavel>('Matheus')
  const [mesInicioIdx, setMesInicioIdx] = useState(0)

  useEffect(() => {
    if (!expandido || !relatorio || relatorio.projecao.length === 0) return
    const ultimoMes = relatorio.projecao[relatorio.projecao.length - 1].mes
    const horizonEnd = format(subMonths(ultimoMes, 1), 'yyyy-MM-dd')
    // Reevita refetch quando nada mudou, mas dispara de novo se o mês selecionado
    // na página (e portanto a janela de projeção) mudou desde a última busca.
    if (horizonEnd === limitesHorizon) return
    fetch(`/api/limites-parcelamentos?ate=${horizonEnd}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => { setLimites(data.limites ?? []); setLimitesHorizon(horizonEnd) })
      .catch(() => { setLimites([]); setLimitesHorizon(horizonEnd) })
  }, [expandido, relatorio, limitesHorizon])

  const valorNum = parseFloat(valorStr.replace(',', '.'))
  const parcelasNum = parseInt(parcelasStr, 10)
  const simulavel = !!relatorio && limites !== null && !isNaN(valorNum) && valorNum > 0 && !isNaN(parcelasNum) && parcelasNum >= 1

  const resultado = useMemo<MesSimulado[]>(() => {
    if (!simulavel || !relatorio || !limites) return []
    const valorParcela = valorNum / parcelasNum
    const meses: MesSimulado[] = []
    for (let k = 0; k < parcelasNum; k++) {
      const idx = mesInicioIdx + k
      if (idx >= relatorio.projecao.length) break
      const mesGasto = relatorio.projecao[idx]
      const baseline = valorPorResponsavel(mesGasto, responsavel)
      const comExtra = baseline + valorParcela
      const calendarMes = subMonths(mesGasto.mes, 1)
      const efetivo = resolverLimiteEfetivo(limites, format(calendarMes, 'yyyy-MM-dd'), responsavel)
      const limite = efetivo?.valor ?? null
      const estoura = limite !== null && limite > 0 && comExtra > limite
      meses.push({ mes: formatarMes(mesGasto.mes), baseline, comExtra, limite, estoura })
    }
    return meses
  }, [simulavel, relatorio, limites, valorNum, parcelasNum, mesInicioIdx, responsavel])

  const foraDaJanela = simulavel && relatorio ? mesInicioIdx + parcelasNum > relatorio.projecao.length : false
  const algumEstoura = resultado.some(m => m.estoura)

  const sugestaoParcelas = useMemo<number | null>(() => {
    if (!simulavel || !relatorio || !limites) return null
    for (let n = MAX_PARCELAS_SUGESTAO; n >= 1; n--) {
      const valorParcela = valorNum / n
      let seguro = true
      for (let k = 0; k < n; k++) {
        const idx = mesInicioIdx + k
        if (idx >= relatorio.projecao.length) continue
        const mesGasto = relatorio.projecao[idx]
        const baseline = valorPorResponsavel(mesGasto, responsavel)
        const calendarMes = subMonths(mesGasto.mes, 1)
        const efetivo = resolverLimiteEfetivo(limites, format(calendarMes, 'yyyy-MM-dd'), responsavel)
        if (efetivo && efetivo.valor > 0 && baseline + valorParcela > efetivo.valor) {
          seguro = false
          break
        }
      }
      if (seguro) return n
    }
    return null
  }, [simulavel, relatorio, limites, valorNum, mesInicioIdx, responsavel])

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpandido(v => !v)}
        aria-expanded={expandido}
        className="w-full flex items-center gap-2 p-4 text-left"
      >
        <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
          <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">O que aconteceria se eu parcelar isso?</h2>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">Simule o impacto de uma nova compra parcelada antes de comprar</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${expandido ? 'rotate-180' : ''}`} />
      </button>

      {expandido && (
        <div className="px-4 pb-4 space-y-3 badge-fade-in">
          <div className="grid grid-cols-2 gap-2">
            <div className={`flex items-center gap-1.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-2.5 py-2 ${CAMPO_FOCO}`}>
              <span className="text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">R$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Valor total"
                value={valorStr}
                onChange={e => setValorStr(e.target.value)}
                aria-label="Valor total da compra"
                className="w-full min-w-0 bg-transparent outline-none text-sm font-semibold text-gray-800 dark:text-gray-100 num"
              />
            </div>
            <div className={`flex items-center gap-1.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-2.5 py-2 ${CAMPO_FOCO}`}>
              <input
                type="number"
                min="1"
                max="48"
                step="1"
                placeholder="Nº parcelas"
                value={parcelasStr}
                onChange={e => setParcelasStr(e.target.value)}
                aria-label="Número de parcelas"
                className="w-full min-w-0 bg-transparent outline-none text-sm font-semibold text-gray-800 dark:text-gray-100 num"
              />
              <span className="text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">x</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={responsavel}
              onChange={e => setResponsavel(e.target.value as Responsavel)}
              aria-label="Responsável pela compra"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
            >
              {RESPONSAVEIS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={mesInicioIdx}
              onChange={e => setMesInicioIdx(Number(e.target.value))}
              aria-label="Mês da primeira parcela"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
            >
              {(relatorio?.projecao ?? []).map((m, i) => (
                <option key={i} value={i}>1ª parcela em {formatarMes(m.mes)}</option>
              ))}
            </select>
          </div>

          {!relatorio || limites === null ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">Carregando dados da projeção…</p>
          ) : !simulavel ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-2 text-center">Informe o valor e o número de parcelas para simular.</p>
          ) : (
            <>
              <div className="space-y-1.5 pt-1">
                {resultado.map((m, i) => {
                  const { texto } = RESPONSAVEL_STYLE[responsavel]
                  return (
                    <div key={i} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${m.estoura ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-800/60'}`}>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{m.mes}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-semibold num ${texto}`}>{formatBRL(m.comExtra)}</span>
                        {m.limite !== null && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 num">/ {formatBRL(m.limite)}</span>
                        )}
                        {m.estoura ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" aria-label="Estoura o limite" />
                        ) : m.limite !== null ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-label="Dentro do limite" />
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>

              {foraDaJanela && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Sem dados de comparação além de 12 meses — parcelas depois desse período não aparecem acima.
                </p>
              )}

              {algumEstoura ? (
                <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Essa compra estouraria o limite de {responsavel} em pelo menos um mês.
                    {sugestaoParcelas && sugestaoParcelas > parcelasNum && (
                      <> Parcelando em até <strong>{sugestaoParcelas}x</strong> ela caberia dentro do limite.</>
                    )}
                    {!sugestaoParcelas && ' Nenhum número de parcelas (até 24x) evita estourar o limite — considere não parcelar agora.'}
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    Essa compra cabe dentro do limite de {responsavel} em todos os meses simulados.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
