'use client'

import { X } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'

type CampoFiltro = 'responsavel' | 'tipo' | 'cartao' | 'categoria' | 'descricao'

const CAMPOS_FILTRO: { value: CampoFiltro; label: string }[] = [
  { value: 'responsavel', label: 'Responsável' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'tipo', label: 'Tipo' },
  { value: 'categoria', label: 'Categoria' },
  { value: 'descricao', label: 'Descrição' },
]

const CARTAO_LABEL: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

function labelValor(campo: CampoFiltro, valor: string, cartaoLabels: Record<string, string>): string {
  if (campo === 'tipo') {
    if (valor === 'cartao') return 'Cartão'
    if (valor === 'extra') return 'Extra'
  }
  if (campo === 'cartao') return cartaoLabels[valor] ?? CARTAO_LABEL[valor] ?? valor
  return valor || '—'
}

function dataOrdenacao(item: any): string {
  return item.data_compra || item.mes_referencia || ''
}

interface Props {
  aberto: boolean
  onClose: () => void
  cartaoLabels?: Record<string, string>
  dados: {
    serie: string
    mes: string
    valor: number
    itens: any[]
  } | null
}

export default function DrawerDetalhes({ aberto, onClose, dados, cartaoLabels }: Props) {
  const [filtroCampo, setFiltroCampo] = useState<CampoFiltro>('responsavel')
  const [filtroValor, setFiltroValor] = useState('Todos')
  const [filtroCampo2, setFiltroCampo2] = useState<CampoFiltro>('cartao')
  const [filtroValor2, setFiltroValor2] = useState('Todos')

  const itens = dados?.itens || []

  useEffect(() => {
    setFiltroCampo('responsavel')
    setFiltroValor('Todos')
    setFiltroCampo2('cartao')
    setFiltroValor2('Todos')
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

  const valoresDisponiveis2 = useMemo(() => {
    const set = new Set<string>()
    itens.forEach(item => {
      const v = item[filtroCampo2]
      if (v) set.add(String(v))
    })
    return ['Todos', ...Array.from(set).sort()]
  }, [itens, filtroCampo2])

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

    if (filtroCampo2 === 'descricao') {
      const termo = filtroValor2.trim().toLowerCase()
      if (termo) {
        filtrados = filtrados.filter(item =>
          String(item.descricao || item.item || '').toLowerCase().includes(termo)
        )
      }
    } else if (filtroValor2 !== 'Todos') {
      filtrados = filtrados.filter(item => String(item[filtroCampo2] || '') === filtroValor2)
    }

    return [...filtrados].sort((a, b) =>
      dataOrdenacao(a).localeCompare(dataOrdenacao(b))
    )
  }, [itens, filtroCampo, filtroValor, filtroCampo2, filtroValor2])

  const valorFiltrado = useMemo(
    () => itensFiltrados.reduce((sum, item) => sum + (item.valor ?? item.valor_previsto ?? 0), 0),
    [itensFiltrados]
  )

  if (!aberto || !dados) return null

  const handleCampoChange = (campo: CampoFiltro) => {
    setFiltroCampo(campo)
    setFiltroValor(campo === 'descricao' ? '' : 'Todos')
    if (campo === filtroCampo2) {
      const proximoCampo = CAMPOS_FILTRO.find(c => c.value !== campo)?.value ?? 'responsavel'
      setFiltroCampo2(proximoCampo)
      setFiltroValor2(proximoCampo === 'descricao' ? '' : 'Todos')
    }
  }

  const handleCampo2Change = (campo: CampoFiltro) => {
    setFiltroCampo2(campo)
    setFiltroValor2(campo === 'descricao' ? '' : 'Todos')
    if (campo === filtroCampo) {
      const proximoCampo = CAMPOS_FILTRO.find(c => c.value !== campo)?.value ?? 'responsavel'
      setFiltroCampo(proximoCampo)
      setFiltroValor(proximoCampo === 'descricao' ? '' : 'Todos')
    }
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
                      {v === 'Todos' ? 'Todos' : labelValor(filtroCampo, v, labelsCartao)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Filtrar por (2)</label>
              <select
                value={filtroCampo2}
                onChange={e => handleCampo2Change(e.target.value as CampoFiltro)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {CAMPOS_FILTRO.filter(c => c.value !== filtroCampo).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Valor (2)</label>
              {filtroCampo2 === 'descricao' ? (
                <input
                  type="text"
                  value={filtroValor2}
                  onChange={e => setFiltroValor2(e.target.value)}
                  placeholder="Buscar descrição..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              ) : (
                <select
                  value={filtroValor2}
                  onChange={e => setFiltroValor2(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {valoresDisponiveis2.map(v => (
                    <option key={v} value={v}>
                      {v === 'Todos' ? 'Todos' : labelValor(filtroCampo2, v, labelsCartao)}
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
              {itensFiltrados.map((item, index) => {
                const cartaoLabel = item.cartao ? (labelsCartao[item.cartao] ?? CARTAO_LABEL[item.cartao] ?? item.cartao) : null
                const cartaoBadgeColor =
                  item.cartao === 'nubank' ? 'bg-purple-100 text-purple-700' :
                  item.cartao === 'cartao1' ? 'bg-blue-100 text-blue-700' :
                  item.cartao === 'cartao2' ? 'bg-pink-100 text-pink-700' : ''
                return (
                  <div key={index} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium flex-1">{item.descricao || item.item}</p>
                      {cartaoLabel && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cartaoBadgeColor}`}>
                          {cartaoLabel}
                        </span>
                      )}
                    </div>
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
                )
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Nenhum item encontrado para este filtro.</p>
          )}
        </div>
      </div>
    </>
  )
}
  const labelsCartao = cartaoLabels ?? CARTAO_LABEL
