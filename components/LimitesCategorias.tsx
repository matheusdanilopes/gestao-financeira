'use client'

import { useEffect, useState } from 'react'
import { format, startOfMonth, addMonths } from 'date-fns'
import { Target } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/format'
import FilterSelect from '@/components/FilterSelect'

type FiltroResponsavel = 'todos' | 'Matheus' | 'Jeniffer' | 'Conjunto'
type FiltroCartao      = 'todos' | 'nubank'  | 'cartao1'  | 'cartao2'

interface Props {
  mesAtual: Date
  cartao1Nome?: string
  cartao2Nome?: string
}

interface CategoriaLimite {
  categoria: string
  limite: number
  gasto: number
}

interface TransacaoRaw {
  categoria: string | null
  valor: number
  responsavel: string | null
  cartao: string | null
}

export default function LimitesCategorias({ mesAtual, cartao1Nome = 'Cartão 1', cartao2Nome = 'Cartão 2' }: Props) {
  const [rawData, setRawData]         = useState<TransacaoRaw[]>([])
  const [limitesMap, setLimitesMap]   = useState<Record<string, number>>({})
  const [carregando, setCarregando]   = useState(true)
  const [filtroResp, setFiltroResp]   = useState<FiltroResponsavel>('todos')
  const [filtroCartao, setFiltroCartao] = useState<FiltroCartao>('todos')

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
          .select('categoria, valor, responsavel, cartao')
          .eq('projeto_fatura', projetoFatura)
          .not('categoria', 'is', null)
          .neq('status', 'ESTORNO')
          .neq('status', 'ESTORNADO'),
      ])

      if (cancelado) return

      const configJson = await configRes.json()
      const configs: Array<{ chave: string; valor: string }> = configJson.configuracoes ?? []

      const lMap: Record<string, number> = {}
      for (const c of configs) {
        if (c.chave.startsWith('limite_cat_')) {
          const catName = c.chave.slice('limite_cat_'.length)
          const val = parseFloat(c.valor)
          if (!isNaN(val) && val > 0) {
            lMap[catName] = val
          }
        }
      }

      if (!cancelado) {
        setLimitesMap(lMap)
        setRawData((transacoes ?? []) as TransacaoRaw[])
        setCarregando(false)
      }
    }

    carregar()
    return () => { cancelado = true }
  }, [mesAtual])

  const itens: CategoriaLimite[] = Object.entries(limitesMap).map(([categoria, limite]) => {
    const gasto = rawData
      .filter(row => {
        if (row.categoria !== categoria) return false
        if (filtroResp !== 'todos' && row.responsavel !== filtroResp) return false
        if (filtroCartao !== 'todos' && row.cartao !== filtroCartao) return false
        return true
      })
      .reduce((s, row) => s + Number(row.valor ?? 0), 0)
    return { categoria, limite, gasto }
  })

  if (carregando || itens.length === 0) return null

  return (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
          <Target className="w-4 h-4 text-amber-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-800">Limites de Orçamento</h2>
      </div>

      <div className="flex gap-2 mb-4">
        <FilterSelect
          value={filtroResp}
          onChange={v => setFiltroResp(v as FiltroResponsavel)}
          options={[
            { value: 'todos',    label: 'Todos'    },
            { value: 'Matheus',  label: 'Matheus'  },
            { value: 'Jeniffer', label: 'Jeniffer' },
            { value: 'Conjunto', label: 'Conjunto' },
          ]}
        />
        <FilterSelect
          value={filtroCartao}
          onChange={v => setFiltroCartao(v as FiltroCartao)}
          options={[
            { value: 'todos',   label: 'Todos os cartões' },
            { value: 'nubank',  label: 'NuBank'           },
            { value: 'cartao1', label: cartao1Nome        },
            { value: 'cartao2', label: cartao2Nome        },
          ]}
        />
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
