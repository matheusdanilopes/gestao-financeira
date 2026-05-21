'use client'

import { X } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
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
  dados: {
    serie: string
    mes: string
    valor: number
    itens: DrawerItem[]
  } | null
}

export default function DrawerDetalhes({ aberto, onClose, dados, cartaoLabels }: Props) {
  const [filtroCampo, setFiltroCampo] = useState<CampoFiltro>('responsavel')
  const [filtroValor, setFiltroValor] = useState('Todos')
  const [filtroCampo2, setFiltroCampo2] = useState<CampoFiltro>('cartao')
  const [filtroValor2, setFiltroValor2] = useState('Todos')
  const [isClosing, setIsClosing] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const labelsCartao = cartaoLabels ?? CARTAO_LABEL

  const itens = dados?.itens || []

  const handleClose = useCallback(() => {
    setIsClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setIsClosing(false)
      onClose()
    }, 220)
  }, [onClose])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiltroCampo('responsavel')
    setFiltroValor('Todos')
    setFiltroCampo2('cartao')
    setFiltroValor2('Todos')
    setIsClosing(false)
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
    <ModalPortal>
      <div
        className={`fixed inset-0 z-[190] transition-opacity ${isClosing ? 'modal-overlay-out' : 'modal-overlay'}`}
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={handleClose}
      />

      <div className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-3xl shadow-xl z-[200] max-h-[82vh] flex flex-col ${isClosing ? 'modal-closing' : 'modal-sheet'}`}>
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>

        {/* Cabeçalho fixo */}
        <div className="sticky-header border-b border-gray-100 dark:border-gray-800 px-4 py-3 space-y-3 shrink-0">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{dados.serie}</h3>
              <p className="text-sm text-gray-500">{dados.mes}</p>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              aria-label="Fechar"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Filtros */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Filtrar por</label>
              <select
                value={filtroCampo}
                onChange={e => handleCampoChange(e.target.value as CampoFiltro)}
                className="input-base text-sm"
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
                  className="input-base text-sm"
                />
              ) : (
                <select
                  value={filtroValor}
                  onChange={e => setFiltroValor(e.target.value)}
                  className="input-base text-sm"
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
              <label className="block text-xs text-gray-400 mb-1">Segundo filtro</label>
              <select
                value={filtroCampo2}
                onChange={e => handleCampo2Change(e.target.value as CampoFiltro)}
                className="input-base text-sm"
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
                  className="input-base text-sm"
                />
              ) : (
                <select
                  value={filtroValor2}
                  onChange={e => setFiltroValor2(e.target.value)}
                  className="input-base text-sm"
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

        {/* Conteúdo scrollável */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          <div className="bg-primary-50 border border-primary-100 rounded-2xl p-3">
            <p className="text-xs text-primary-600 font-medium mb-0.5">Valor total</p>
            <p className="text-2xl font-bold text-primary-700 num">
              {formatBRL(itensFiltrados.length === itens.length ? dados.valor : valorFiltrado)}
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-baseline gap-2">
              Composição
              {itensFiltrados.length < itens.length && (
                <span className="text-xs font-normal text-gray-400">
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
                    <div key={index} className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm text-gray-800 dark:text-gray-200 flex-1">{item.descricao || item.item}</p>
                        {cartaoLabel && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${cartaoBadgeColor}`}>
                            {cartaoLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.responsavel && item.responsavel}
                        {item.data_compra && (
                          <> · {new Date(item.data_compra + 'T12:00:00').toLocaleDateString('pt-BR')}</>
                        )}
                      </p>
                      <p className="text-sm font-bold text-emerald-600 mt-1 num">
                        {formatBRL(item.valor ?? item.valor_previsto ?? 0)}
                      </p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-6">Nenhum item encontrado para este filtro.</p>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
