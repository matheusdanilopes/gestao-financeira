'use client'

import { X } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'

type CampoFiltro = 'responsavel' | 'tipo' | 'categoria' | 'descricao'

const CAMPOS_FILTRO: { value: CampoFiltro; label: string }[] = [
  { value: 'responsavel', label: 'Responsável' },
  { value: 'tipo', label: 'Tipo' },
  { value: 'categoria', label: 'Categoria' },
  { value: 'descricao', label: 'Descrição' },
]

function labelValor(campo: CampoFiltro, valor: string): string {
  if (campo === 'tipo') {
    if (valor === 'cartao') return 'Cartão'
    if (valor === 'extra') return 'Extra'
  }
  return valor || '—'
}

function dataOrdenacao(item: any): string {
  return item.data_compra || item.mes_referencia || ''
}

interface Props {
  aberto: boolean
  onClose: () => void
  dados: {
    serie: string
    mes: string
    valor: number
    itens: any[]
  } | null
}

export default function DrawerDetalhes({ aberto, onClose, dados }: Props) {
  const [filtroCampo, setFiltroCampo] = useState<CampoFiltro>('responsavel')
  const [filtroValor, setFiltroValor] = useState('Todos')

  const itens = dados?.itens || []

  useEffect(() => {
    setFiltroCampo('responsavel')
    setFiltroValor('Todos')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados])

  const valoresDisponiveis = useMemo(() => {
    const set = new Set<string>()
    itens.forEach(item => {
      const v = item[filtroCampo]
      if (v) set.add(String(v))
    })
    return ['Todos', ...Array.from(set).sort()]
  }, [itens, filtroCampo])

  const itensFiltrados = useMemo(() => {
    let filtrados = itens
    if (filtroCampo === 'descricao') {
      const termo = filtroValor.trim().toLowerCase()
      if (termo) {
        filtrados = itens.filter(item =>
          String(item.descricao || item.item || '').toLowerCase().includes(termo)
        )
      }
    } else if (filtroValor !== 'Todos') {
      filtrados = itens.filter(item => String(item[filtroCampo] || '') === filtroValor)
    }

    return [...filtrados].sort((a, b) =>
      dataOrdenacao(a).localeCompare(dataOrdenacao(b))
    )
  }, [itens, filtroCampo, filtroValor])

  const valorFiltrado = useMemo(
    () => itensFiltrados.reduce((sum, item) => sum + (item.valor ?? item.valor_previsto ?? 0), 0),
    [itensFiltrados]
  )

  if (!aberto || !dados) return null

  const handleCampoChange = (campo: CampoFiltro) => {
    setFiltroCampo(campo)
    setFiltroValor(campo === 'descricao' ? '' : 'Todos')
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 transition-opacity" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl z-50 max-h-[80vh] overflow-y-auto">
        {/* Cabeçalho fixo */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-bold">{dados.serie}</h3>
              <p className="text-sm text-gray-500">{dados.mes}</p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Filtros */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Filtrar por</label>
              <select
                value={filtroCampo}
                onChange={e => handleCampoChange(e.target.value as CampoFiltro)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {CAMPOS_FILTRO.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Valor</label>
              {filtroCampo === 'descricao' ? (
                <input
                  type="text"
                  value={filtroValor}
                  onChange={e => setFiltroValor(e.target.value)}
                  placeholder="Buscar descrição..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              ) : (
                <select
                  value={filtroValor}
                  onChange={e => setFiltroValor(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {valoresDisponiveis.map(v => (
                    <option key={v} value={v}>
                      {v === 'Todos' ? 'Todos' : labelValor(filtroCampo, v)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="bg-blue-50 rounded-lg p-3 mb-4">
            <p className="text-sm text-gray-600">Valor total</p>
            <p className="text-2xl font-bold text-blue-600">
              R$ {(itensFiltrados.length === itens.length ? dados.valor : valorFiltrado).toFixed(2)}
            </p>
          </div>

          <h4 className="font-semibold mb-2 flex items-baseline gap-2">
            Itens que compõem este valor:
            {itensFiltrados.length < itens.length && (
              <span className="text-sm font-normal text-gray-400">
                {itensFiltrados.length} de {itens.length}
              </span>
            )}
          </h4>

          {itensFiltrados.length > 0 ? (
            <div className="space-y-2">
              {itensFiltrados.map((item, index) => (
                <div key={index} className="bg-gray-50 rounded-lg p-3">
                  <p className="font-medium">{item.descricao || item.item}</p>
                  <p className="text-sm text-gray-500">
                    {item.responsavel && `Responsável: ${item.responsavel}`}
                    {item.data_compra && (
                      <> · {new Date(item.data_compra + 'T12:00:00').toLocaleDateString('pt-BR')}</>
                    )}
                  </p>
                  <p className="text-sm font-semibold text-green-600">
                    R$ {(item.valor ?? item.valor_previsto)?.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Nenhum item encontrado para este filtro.</p>
          )}
        </div>
      </div>
    </>
  )
}
