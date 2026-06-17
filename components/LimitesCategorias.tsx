'use client'

import { useEffect, useState } from 'react'
import { format, startOfMonth, addMonths } from 'date-fns'
import { Target } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/logger'

interface Props {
  mesAtual: Date
}

interface CategoriaLimite {
  categoria: string
  limite: number
  gasto: number
}

export default function LimitesCategorias({ mesAtual }: Props) {
  const [itens, setItens] = useState<CategoriaLimite[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setCarregando(true)

      // NuBank transactions for a given planning month appear on the next month's invoice
      const projetoFatura = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')

      const [configRes, { data: transacoes }] = await Promise.all([
        fetch('/api/configuracoes'),
        supabase
          .from('transacoes_nubank')
          .select('categoria, valor')
          .eq('projeto_fatura', projetoFatura)
          .not('categoria', 'is', null)
          .neq('status', 'ESTORNO')
          .neq('status', 'ESTORNADO'),
      ])

      if (cancelado) return

      const configJson = await configRes.json()
      const configs: Array<{ chave: string; valor: string }> = configJson.configuracoes ?? []

      const limitesMap: Record<string, number> = {}
      for (const c of configs) {
        if (c.chave.startsWith('limite_cat_')) {
          const catName = c.chave.slice('limite_cat_'.length)
          const val = parseFloat(c.valor)
          if (!isNaN(val) && val > 0) {
            limitesMap[catName] = val
          }
        }
      }

      const gastosMap: Record<string, number> = {}
      for (const row of (transacoes ?? [])) {
        const cat = row.categoria as string | null
        if (cat) gastosMap[cat] = (gastosMap[cat] ?? 0) + Number(row.valor ?? 0)
      }

      const result: CategoriaLimite[] = Object.entries(limitesMap).map(([categoria, limite]) => ({
        categoria,
        limite,
        gasto: gastosMap[categoria] ?? 0,
      }))

      if (!cancelado) {
        setItens(result)
        setCarregando(false)
      }
    }

    carregar()
    return () => { cancelado = true }
  }, [mesAtual])

  if (carregando || itens.length === 0) return null

  return (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
          <Target className="w-4 h-4 text-amber-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-800">Limites de Orçamento</h2>
      </div>
      <div className="space-y-4">
        {itens.map(({ categoria, limite, gasto }) => {
          const pct = limite > 0 ? (gasto / limite) * 100 : 0
          return (
            <div key={categoria}>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-xs font-medium text-gray-700">{categoria}</span>
                <span className={`text-[11px] font-semibold num ${pct >= 100 ? 'text-red-500' : pct >= 80 ? 'text-amber-500' : 'text-gray-400'}`}>
                  {formatBRL(gasto)} / {formatBRL(limite)}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${pct < 80 ? 'bg-emerald-500' : pct < 100 ? 'bg-amber-400' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              {pct >= 80 && (
                <p className="text-[10px] text-right mt-0.5 font-semibold" style={{ color: pct >= 100 ? '#ef4444' : '#f59e0b' }}>
                  {pct >= 100 ? `Limite ultrapassado em ${formatBRL(gasto - limite)}` : `${pct.toFixed(0)}% do limite`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
