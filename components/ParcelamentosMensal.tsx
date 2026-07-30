'use client'

import { useEffect, useState } from 'react'
import { format, startOfMonth, addMonths } from 'date-fns'
import { Layers } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/logger'

interface Props {
  mesAtual: Date
}

const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Conjunto'] as const
type Responsavel = typeof RESPONSAVEIS[number]

const RESPONSAVEL_COR: Record<Responsavel, string> = {
  Matheus: 'text-blue-600 dark:text-blue-400',
  Jeniffer: 'text-pink-500 dark:text-pink-400',
  Conjunto: 'text-violet-600 dark:text-violet-400',
}

interface ParcelaRaw {
  valor: number
  responsavel: string | null
}

export default function ParcelamentosMensal({ mesAtual }: Props) {
  const [limites, setLimites] = useState<Record<string, number>>({})
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [comprometidoPorPessoa, setComprometidoPorPessoa] = useState<Record<string, number>>({})
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)

  const mesReferencia = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setCarregando(true)

      const projetoFatura = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')

      const [limitesRes, { data: transacoes }, { data: planejados }] = await Promise.all([
        fetch(`/api/limites-parcelamentos?mes=${mesReferencia}`),
        supabase
          .from('transacoes_nubank')
          .select('valor, responsavel')
          .eq('projeto_fatura', projetoFatura)
          .gt('total_parcelas', 1)
          .neq('status', 'ESTORNO')
          .neq('status', 'ESTORNADO'),
        supabase
          .from('planejamento')
          .select('valor_previsto, responsavel')
          .eq('mes_referencia', mesReferencia)
          .gt('total_parcelas', 1),
      ])

      if (cancelado) return

      const limitesJson = await limitesRes.json()
      const limitesData: Array<{ responsavel: string; valor: number }> = limitesJson.limites ?? []

      const lMap: Record<string, number> = {}
      const iMap: Record<string, string> = {}
      for (const l of limitesData) {
        lMap[l.responsavel] = Number(l.valor ?? 0)
        iMap[l.responsavel] = String(l.valor ?? '')
      }

      const parcelas: ParcelaRaw[] = [
        ...(transacoes ?? []).map(t => ({ valor: Number(t.valor ?? 0), responsavel: t.responsavel })),
        ...(planejados ?? []).map(p => ({ valor: Number(p.valor_previsto ?? 0), responsavel: p.responsavel })),
      ]

      const cMap: Record<string, number> = {}
      for (const p of parcelas) {
        if (!p.responsavel) continue
        cMap[p.responsavel] = (cMap[p.responsavel] ?? 0) + p.valor
      }

      if (!cancelado) {
        setLimites(lMap)
        setInputs(iMap)
        setComprometidoPorPessoa(cMap)
        setCarregando(false)
      }
    }

    carregar()
    return () => { cancelado = true }
  }, [mesReferencia, mesAtual])

  async function salvarLimite(responsavel: Responsavel, valorStr: string) {
    const valor = parseFloat(valorStr.replace(',', '.'))
    const valorFinal = !isNaN(valor) && valor > 0 ? valor : 0

    setSalvando(responsavel)
    try {
      await fetch('/api/limites-parcelamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limites: [{ mes_referencia: mesReferencia, responsavel, valor: valorFinal }] }),
      })
      setLimites(prev => ({ ...prev, [responsavel]: valorFinal }))
    } finally {
      setSalvando(null)
    }
  }

  const totalComprometido = RESPONSAVEIS.reduce((s, r) => s + (comprometidoPorPessoa[r] ?? 0), 0)
  const totalLimite = RESPONSAVEIS.reduce((s, r) => s + (limites[r] ?? 0), 0)

  return (
    <div className="space-y-3">
      {!carregando && totalLimite > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Total comprometido no mês</p>
          <p className="text-lg font-bold text-gray-800 dark:text-gray-100 num">
            {formatBRL(totalComprometido)} <span className="text-sm font-medium text-gray-400">/ {formatBRL(totalLimite)}</span>
          </p>
        </div>
      )}

      {RESPONSAVEIS.map(responsavel => {
        const limite = limites[responsavel] ?? 0
        const gasto = comprometidoPorPessoa[responsavel] ?? 0
        const pct = limite > 0 ? (gasto / limite) * 100 : 0

        return (
          <div key={responsavel} className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center">
                <Layers className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              </div>
              <h2 className={`text-base font-semibold ${RESPONSAVEL_COR[responsavel]}`}>{responsavel}</h2>
            </div>

            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Limite do mês</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Sem limite"
                  value={inputs[responsavel] ?? ''}
                  onChange={(e) => setInputs(prev => ({ ...prev, [responsavel]: e.target.value }))}
                  onBlur={(e) => salvarLimite(responsavel, e.target.value)}
                  disabled={salvando === responsavel}
                  className="w-28 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400 transition-shadow"
                />
              </div>
            </div>

            <div className="flex justify-between items-baseline mb-1">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Comprometido</span>
              <span className={`text-[11px] font-semibold num ${pct >= 100 ? 'text-red-500' : pct >= 80 ? 'text-amber-500' : 'text-gray-400'}`}>
                {formatBRL(gasto)}{limite > 0 ? ` / ${formatBRL(limite)}` : ''}
              </span>
            </div>

            {limite > 0 && (
              <>
                <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${pct < 80 ? 'bg-emerald-500' : pct < 100 ? 'bg-amber-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-right mt-0.5 font-semibold" style={{ color: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#6b7280' }}>
                  {pct >= 100
                    ? `Limite ultrapassado em ${formatBRL(gasto - limite)}`
                    : `Ainda pode comprometer ${formatBRL(limite - gasto)}`}
                </p>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
