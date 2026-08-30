'use client'

import { useState, useEffect } from 'react'
import { format, startOfMonth } from 'date-fns'
import { Lightbulb, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { supabase } from '@/lib/supabaseClient'
import { buscarCartaoLabels, CARTAO_LABELS_PADRAO, type CartaoLabels } from '@/lib/cartaoLabels'

interface Sugestao {
  descricao: string
  responsavel: string
  cartao: string
  aparicoes: number
  meses: string[]
  valor_medio: number
  valor_min: number
  valor_max: number
  variacao_percentual: number
}

interface Props {
  onAdicionarAssinatura?: (descricao: string, valor: number, cartao: string, responsavel: string) => void
}

export default function SugestoesAssinaturas({ onAdicionarAssinatura: _onAdicionar }: Props) {
  function onAdicionarAssinatura(descricao: string, valor: number, cartao: string, responsavel: string) {
    if (_onAdicionar) { _onAdicionar(descricao, valor, cartao, responsavel); return }
    window.dispatchEvent(new CustomEvent('assinaturas:pre-preencher', {
      detail: { nome: descricao, valor, cartao, responsavel },
    }))
  }
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [carregando, setCarregando] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const [cartaoLabels, setCartaoLabels] = useState<CartaoLabels>(CARTAO_LABELS_PADRAO)
  const [ignoradas, setIgnoradas] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('assinaturas-sugestoes-ignoradas')
      return new Set<string>(raw ? JSON.parse(raw) : [])
    } catch { return new Set<string>() }
  })

  useEffect(() => {
    async function carregar() {
      setCarregando(true)
      try {
        const res = await fetch('/api/assinaturas/sugestoes')
        if (!res.ok) return
        const data = await res.json()
        setSugestoes(data.sugestoes ?? [])
      } catch { /* silently fail */ } finally {
        setCarregando(false)
      }
    }
    carregar()
    const mesRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    buscarCartaoLabels(supabase, mesRef).then(setCartaoLabels)
  }, [])

  function ignorar(descricao: string) {
    const novo = new Set(ignoradas)
    novo.add(descricao)
    setIgnoradas(novo)
    try { localStorage.setItem('assinaturas-sugestoes-ignoradas', JSON.stringify([...novo])) } catch { /* noop */ }
  }

  const visiveis = sugestoes.filter((s: Sugestao) => !ignoradas.has(s.descricao))

  if (carregando || visiveis.length === 0) return null

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-3xl overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setExpandido((v: boolean) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-none">
          <Lightbulb className="w-4 h-4 text-amber-600" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-bold text-amber-800 leading-none">
            {visiveis.length} sugestão{visiveis.length > 1 ? 'ões' : ''} detectada{visiveis.length > 1 ? 's' : ''}
          </p>
          <p className="text-xs text-amber-600 mt-0.5">Gastos recorrentes que podem ser assinaturas</p>
        </div>
        {expandido
          ? <ChevronUp className="w-4 h-4 text-amber-500 flex-none" strokeWidth={2} />
          : <ChevronDown className="w-4 h-4 text-amber-500 flex-none" strokeWidth={2} />}
      </button>

      {expandido && (
        <div className="border-t border-amber-200 divide-y divide-amber-100">
          {visiveis.map((s: Sugestao) => (
            <div key={s.descricao} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{s.descricao}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {s.responsavel} · {cartaoLabels[s.cartao as keyof CartaoLabels] || s.cartao} · {s.aparicoes}× nos últimos 6 meses
                </p>
                <p className="text-xs font-semibold text-amber-700 mt-0.5 num">
                  {formatBRL(s.valor_medio)}/mês
                  {s.variacao_percentual > 5 && (
                    <span className="text-gray-400 font-normal"> (varia {s.variacao_percentual}%)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-none">
                <button
                  type="button"
                  onClick={() => onAdicionarAssinatura(s.descricao, s.valor_medio, s.cartao, s.responsavel)}
                  className="w-8 h-8 rounded-xl bg-amber-500 hover:bg-amber-600 flex items-center justify-center
                             text-white transition-colors active:scale-90"
                  title="Adicionar como assinatura"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => ignorar(s.descricao)}
                  className="w-8 h-8 rounded-xl bg-amber-100 hover:bg-amber-200 flex items-center justify-center
                             text-amber-600 transition-colors active:scale-90"
                  title="Ignorar sugestão"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
