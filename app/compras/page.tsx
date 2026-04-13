'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, subMonths, format, startOfMonth, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import BottomNav from '@/components/BottomNav'

type Compra = {
  hash_linha: string
  data_compra: string | null
  data: string | null
  descricao: string
  valor: number
  responsavel: string
  parcela_atual: number | null
  total_parcelas: number | null
  categoria: string | null
}

function formatarData(dataStr: string): string {
  const raw = dataStr.substring(0, 10)
  if (!raw || raw.length < 10) return raw
  try {
    const parsed = parse(raw, 'yyyy-MM-dd', new Date())
    return format(parsed, 'dd/MM')
  } catch {
    return raw
  }
}

function borderColor(responsavel: string): string {
  if (responsavel === 'Matheus') return 'border-l-4 border-l-blue-400'
  if (responsavel === 'Jeniffer') return 'border-l-4 border-l-pink-400'
  return 'border-l-4 border-l-gray-200'
}

export default function ComprasPage() {
  const [mesAtual, setMesAtual] = useState(() => addMonths(new Date(), 1))
  const [compras, setCompras] = useState<Compra[]>([])
  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroDia, setFiltroDia] = useState('')

  useEffect(() => { carregarCompras() }, [mesAtual])

  async function carregarCompras() {
    const mesRef = format(startOfMonth(mesAtual), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', mesRef)
    setCompras(data || [])
  }

  const filtrosAtivos = !!filtroResponsavel || !!filtroDescricao || !!filtroValorMin || !!filtroDia

  function limparFiltros() {
    setFiltroResponsavel('')
    setFiltroDescricao('')
    setFiltroValorMin('')
    setFiltroDia('')
  }

  const comprasFiltradas = useMemo(() => {
    return compras.filter((c) => {
      const dataStr = (c.data_compra || c.data || '').toString().substring(0, 10)
      const diaCompra = dataStr ? Number(dataStr.substring(8, 10)) : null
      const passaResponsavel = !filtroResponsavel || c.responsavel === filtroResponsavel
      const passaDescricao = !filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())
      const passaValor = !filtroValorMin || c.valor >= Number(filtroValorMin)
      const passaDia = !filtroDia || diaCompra === Number(filtroDia)
      return passaResponsavel && passaDescricao && passaValor && passaDia
    })
  }, [compras, filtroResponsavel, filtroDescricao, filtroValorMin, filtroDia])

  const total = useMemo(() => comprasFiltradas.reduce((acc, c) => acc + c.valor, 0), [comprasFiltradas])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Compras do Cartão</h1>

      <div className="flex items-center justify-between bg-white rounded-xl shadow p-3 mb-4">
        <button onClick={() => setMesAtual(subMonths(mesAtual, 1))} className="p-2 hover:bg-gray-100 rounded-full">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-lg font-semibold capitalize">
          {format(mesAtual, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button onClick={() => setMesAtual(addMonths(mesAtual, 1))} className="p-2 hover:bg-gray-100 rounded-full">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-3 mb-3 grid grid-cols-2 gap-2">
        <select className="bg-gray-50 rounded-lg p-2 text-sm" value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)}>
          <option value="">Responsável (todos)</option>
          <option value="Matheus">Matheus</option>
          <option value="Jeniffer">Jeniffer</option>
        </select>
        <input className="bg-gray-50 rounded-lg p-2 text-sm" placeholder="Descrição" value={filtroDescricao} onChange={(e) => setFiltroDescricao(e.target.value)} />
        <input className="bg-gray-50 rounded-lg p-2 text-sm" type="number" min="0" placeholder="Valor mínimo" value={filtroValorMin} onChange={(e) => setFiltroValorMin(e.target.value)} />
        <input className="bg-gray-50 rounded-lg p-2 text-sm" type="number" min="1" max="31" placeholder="Dia" value={filtroDia} onChange={(e) => setFiltroDia(e.target.value)} />
        {filtrosAtivos && (
          <button onClick={limparFiltros} className="col-span-2 text-sm text-red-500 hover:text-red-700 py-1">
            Limpar filtros
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-3 mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">Total filtrado no mês</p>
        <div className="text-right">
          <p className="text-lg font-bold text-blue-700">R$ {total.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{comprasFiltradas.length} compras</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow divide-y overflow-hidden">
        {comprasFiltradas.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center gap-2">
            <p className="text-gray-300 text-4xl">🛒</p>
            <p className="text-sm text-gray-400">Nenhuma compra encontrada</p>
          </div>
        ) : (
          comprasFiltradas.map((c) => {
            const dataStr = (c.data_compra || c.data || '').toString()
            return (
              <div key={c.hash_linha} className={`p-3 flex items-center justify-between gap-2 ${borderColor(c.responsavel)}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.descricao}</p>
                  <p className="text-xs text-gray-500">
                    {formatarData(dataStr)} · {c.responsavel}
                    {c.categoria && <span className="ml-1 bg-gray-100 px-1.5 py-0.5 rounded text-[10px] text-gray-500">{c.categoria}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">R$ {c.valor.toFixed(2)}</p>
                  {c.parcela_atual && c.total_parcelas && (
                    <p className="text-xs text-gray-400">{c.parcela_atual}/{c.total_parcelas}</p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <BottomNav />
    </div>
  )
}
