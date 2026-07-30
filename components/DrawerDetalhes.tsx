'use client'

import { X } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { useState, useMemo, useEffect } from 'react'
import { formatBRL } from '@/lib/logger'

type CampoFiltro = 'responsavel' | 'tipo' | 'cartao' | 'categoria' | 'descricao'

type DrawerItem = {
  descricao?: string | null
  item?: string | null
  cartao?: string | null
  responsavel?: string | null
  data_compra?: string | null
  mes_referencia?: string | null
  valor?: number | null
  valor_previsto?: number | null
  tipo?: string | null
  categoria?: string | null
  [key: string]: unknown
}

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

function dataOrdenacao(item: DrawerItem): string {
  return item.data_compra || item.mes_referencia || ''
}

interface Props {
  aberto: boolean
  onClose: () => void
  cartaoLabels?: Record<string, string>
  filtroInicial?: CampoFiltro
  dados: {
    serie: string
    mes: string
    valor: number
    itens: DrawerItem[]
  } | null
}

export default function DrawerDetalhes({ aberto, onClose, dados, cartaoLabels, filtroInicial = 'responsavel' }: Props) {
  const [filtroCampo, setFiltroCampo] = useState<CampoFiltro>(filtroInicial)
  const [filtroValor, setFiltroValor] = useState('Todos')
  const [filtroCampo2, setFiltroCampo2] = useState<CampoFiltro>('cartao')
  const [filtroValor2, setFiltroValor2] = useState('Todos')
  const labelsCartao = cartaoLabels ?? CARTAO_LABEL

  const itens = dados?.itens || []

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiltroCampo(filtroInicial)
    setFiltroValor('Todos')
    setFiltroCampo2(filtroInicial === 'cartao' ? 'responsavel' : 'cartao')
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

  const filterSelectClass = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:focus:ring-primary-500 focus:border-transparent transition-shadow duration-150"

  return (
    <>
      <ModalPortal>
      <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[190] modal-overlay" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-3xl shadow-float z-[200] max-h-[84vh] overflow-y-auto modal-sheet">
        {/* Cabeçalho fixo — drag handle + título + filtros em um único bloco sticky,
            sem fresta entre blocos por onde a lista poderia aparecer por trás */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div className="px-4 pb-4 pt-1 space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">{dados.serie}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{dados.mes}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors active:scale-90"
              aria-label="Fechar"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          {/* Filtros */}
          <div className="flex gap-2.5">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide">Filtrar por</label>
              <select
                value={filtroCampo}
                onChange={e => handleCampoChange(e.target.value as CampoFiltro)}
                className={filterSelectClass}
              >
                {CAMPOS_FILTRO.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide">Valor</label>
              {filtroCampo === 'descricao' ? (
                <input
                  type="text"
                  value={filtroValor}
                  onChange={e => setFiltroValor(e.target.value)}
                  placeholder="Buscar descrição..."
                  className={filterSelectClass}
                />
              ) : (
                <select
                  value={filtroValor}
                  onChange={e => setFiltroValor(e.target.value)}
                  className={filterSelectClass}
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
          <div className="flex gap-2.5">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide">Filtrar por (2)</label>
              <select
                value={filtroCampo2}
                onChange={e => handleCampo2Change(e.target.value as CampoFiltro)}
                className={filterSelectClass}
              >
                {CAMPOS_FILTRO.filter(c => c.value !== filtroCampo).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide">Valor (2)</label>
              {filtroCampo2 === 'descricao' ? (
                <input
                  type="text"
                  value={filtroValor2}
                  onChange={e => setFiltroValor2(e.target.value)}
                  placeholder="Buscar descrição..."
                  className={filterSelectClass}
                />
              ) : (
                <select
                  value={filtroValor2}
                  onChange={e => setFiltroValor2(e.target.value)}
                  className={filterSelectClass}
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
        </div>

        <div className="relative z-0 p-4 pb-8">
          {/* Total card */}
          <div className="bg-primary-50 dark:bg-primary-900/20 rounded-2xl p-4 mb-4 border border-primary-100 dark:border-primary-900/40">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Valor total</p>
            <p className="text-2xl font-bold text-primary-700 dark:text-primary-300 num tracking-tight">
              {formatBRL(itensFiltrados.length === itens.length ? dados.valor : valorFiltrado)}
            </p>
          </div>

          <h4 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-baseline gap-2">
            Itens que compõem este valor
            {itensFiltrados.length < itens.length && (
              <span className="text-xs font-normal text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                {itensFiltrados.length} de {itens.length}
              </span>
            )}
          </h4>

          {itensFiltrados.length > 0 ? (
            <div className="space-y-2">
              {itensFiltrados.map((item, index) => {
                const cartaoLabel = item.cartao ? (labelsCartao[item.cartao] ?? CARTAO_LABEL[item.cartao] ?? item.cartao) : null
                const cartaoBadgeColor =
                  item.cartao === 'nubank' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                  item.cartao === 'cartao1' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                  item.cartao === 'cartao2' ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' : ''
                return (
                  <div key={index} className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3.5 border border-gray-100 dark:border-gray-700/50">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-medium text-gray-800 dark:text-gray-100 flex-1 text-sm leading-snug">{item.descricao || item.item}</p>
                      {cartaoLabel && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cartaoBadgeColor}`}>
                          {cartaoLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {item.responsavel && `${item.responsavel}`}
                      {item.data_compra && (
                        <> · {new Date(item.data_compra + 'T12:00:00').toLocaleDateString('pt-BR')}</>
                      )}
                    </p>
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400 mt-1 num">
                      {formatBRL(item.valor ?? item.valor_previsto ?? 0)}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-6">Nenhum item encontrado para este filtro.</p>
          )}
        </div>
      </div>
      </ModalPortal>
    </>
  )
}
