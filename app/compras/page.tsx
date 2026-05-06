'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalSync } from '@/lib/useGlobalSync'
import { Pencil, Trash2, X, ShoppingBag, Lock, WifiOff, SlidersHorizontal, ChevronDown } from 'lucide-react'
import MonthSelector from '@/components/MonthSelector'
import EmptyState from '@/components/EmptyState'
import { addMonths, subMonths, format, startOfMonth, isToday, isYesterday, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { log, numericOnly } from '@/lib/logger'
import { useMes } from '@/components/MesProvider'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'
import { calcularProjetoFatura } from '@/lib/fatura'

const CATEGORIA_CORES: Record<string, string> = {
  Alimentação: 'bg-orange-100 text-orange-700',
  Mercado:     'bg-green-100 text-green-700',
  Transporte:  'bg-sky-100 text-sky-700',
  Saúde:       'bg-red-100 text-red-700',
  Lazer:       'bg-purple-100 text-purple-700',
  Educação:    'bg-indigo-100 text-indigo-700',
  Moradia:     'bg-yellow-100 text-yellow-800',
  Vestuário:   'bg-pink-100 text-pink-700',
  Tecnologia:  'bg-cyan-100 text-cyan-700',
  Serviços:    'bg-teal-100 text-teal-700',
  Viagem:      'bg-blue-100 text-blue-700',
  Pet:         'bg-lime-100 text-lime-700',
  Outros:      'bg-gray-100 text-gray-600',
}

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
  cartao?: string
}

type FormEditar = {
  descricao: string
  valor: string
  responsavel: string
  categoria: string
  data_compra: string
}

function dataEfetiva(c: Compra): string {
  return ((c.data_compra || c.data || '')).toString().substring(0, 10)
}

function formatarCabecalhoData(dateKey: string): string {
  if (!dateKey || dateKey.length < 10) return dateKey
  try {
    const d = parseISO(dateKey)
    if (isToday(d)) return 'Hoje'
    if (isYesterday(d)) return 'Ontem'
    return format(d, "EEEE',' dd 'de' MMMM", { locale: ptBR })
  } catch {
    return dateKey
  }
}

function dataParaInput(dataStr: string | null): string {
  if (!dataStr) return format(new Date(), 'yyyy-MM-dd')
  return dataStr.toString().substring(0, 10)
}

const CARTAO_LABEL: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

const CARTAO_BADGE_COLOR: Record<string, string> = {
  nubank: 'bg-purple-100 text-purple-700',
  cartao1: 'bg-blue-100 text-blue-700',
  cartao2: 'bg-pink-100 text-pink-700',
}

function Avatar({ responsavel }: { responsavel: string }) {
  if (responsavel === 'Matheus')
    return <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">M</span>
  if (responsavel === 'Jeniffer')
    return <span className="flex-shrink-0 w-7 h-7 rounded-full bg-pink-100 text-pink-700 text-xs font-bold flex items-center justify-center">J</span>
  return <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center">?</span>
}

function CategoriaBadge({ categoria }: { categoria: string | null }) {
  if (!categoria) return null
  const cor = CATEGORIA_CORES[categoria] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cor}`}>
      {categoria}
    </span>
  )
}

function CartaoBadge({ cartao, labels }: { cartao?: string; labels: Record<string, string> }) {
  if (!cartao) return null
  const label = labels[cartao] ?? cartao
  const cor = CARTAO_BADGE_COLOR[cartao] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cor}`}>
      {label}
    </span>
  )
}

export default function ComprasPage() {
  const { mesAtual: mesGlobal, setMesAtual } = useMes()
  const mesAtual = addMonths(mesGlobal, 1)
  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM')

  const [compras, setCompras] = useState<Compra[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [filtroCartao, setFiltroCartao] = useState<'' | 'nubank' | 'cartao1' | 'cartao2'>('')
  const [filtroDescricaoInput, setFiltroDescricaoInput] = useState('')
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const filtroDescricaoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroDia, setFiltroDia] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO)

  const [modalEditar, setModalEditar] = useState<Compra | null>(null)
  const [modalExcluir, setModalExcluir] = useState<Compra | null>(null)
  const [formEditar, setFormEditar] = useState<FormEditar>({
    descricao: '', valor: '', responsavel: 'Matheus', categoria: '', data_compra: '',
  })
  const [salvando, setSalvando] = useState(false)
  const [filtrosExpandidos, setFiltrosExpandidos] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
  const [faturaFechada, setFaturaFechada] = useState(false)
  const [diaVencimento, setDiaVencimento] = useState(10)
  const [ajusteFechamento, setAjusteFechamento] = useState(0)
  const [cartaoLabels, setCartaoLabels] = useState(CARTAO_LABEL)

  const mesAtualKey = format(startOfMonth(mesAtual), 'yyyy-MM')
  const mesRefStr = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

  // Fetcher estável para o useDataSync
  const fetcherCompras = useCallback(async () => {
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', mesRefStr)
      .order('data', { ascending: false })
    return data || []
  }, [mesRefStr])

  // Sincronização automática: Realtime + polling 45s + cache localStorage
  const { isOnline } = useGlobalSync({
    cacheKey: `compras:${mesRefStr}`,
    tables: ['transacoes_nubank'],
    fetcher: fetcherCompras,
    onData: (data: unknown) => { setCompras(data as Compra[]); setLoading(false) },
    pollInterval: 45_000,
  })

  // Pula fetch manual no primeiro render (useDataSync já cuida)
  const isFirstRender = useRef(true)

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  async function carregarCompras() {
    setLoading(true)
    const mesRef = format(startOfMonth(mesAtual), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', mesRef)
      .order('data', { ascending: false })
    setCompras(data || [])
    setLoading(false)
  }

  async function carregarCategorias() {
    const res = await fetch('/api/configuracoes')
    const data = await res.json()
    const configs: Array<{ chave: string; valor: string }> = data.configuracoes ?? []
    const categoriasConfig = configs.find(c => c.chave === 'categorias_compras')
    setCategorias(parseCategoriasConfig(categoriasConfig?.valor))
    setDiaVencimento(parseInt(configs.find(c => c.chave === 'dia_vencimento')?.valor || '10'))
    setAjusteFechamento(parseInt(configs.find(c => c.chave === 'ajuste_fechamento')?.valor || '0'))
  }

  async function carregarLabelsCartao() {
    const mesRef = format(startOfMonth(mesGlobal), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('planejamento')
      .select('item')
      .eq('mes_referencia', mesRef)

    const c1 = (data || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
    const c2 = (data || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()
    setCartaoLabels({
      nubank: 'NuBank',
      cartao1: c1 || 'Cartão 1',
      cartao2: c2 || 'Cartão 2',
    })
  }

  async function verificarFaturaFechada() {
    const mesRef = format(startOfMonth(mesGlobal), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('planejamento')
      .select('pago')
      .eq('mes_referencia', mesRef)
      .ilike('item', 'NuBank%')
    setFaturaFechada((data || []).some(p => p.pago))
  }

  function abrirEditar(c: Compra) {
    setFormEditar({
      descricao: c.descricao,
      valor: String(c.valor),
      responsavel: c.responsavel,
      categoria: c.categoria || '',
      data_compra: dataParaInput(c.data_compra || c.data),
    })
    setModalEditar(c)
  }

  async function salvarEdicao() {
    if (!modalEditar) return
    const valor = parseFloat(formEditar.valor.replace(',', '.'))
    if (!formEditar.descricao.trim() || isNaN(valor) || valor <= 0) return

    setSalvando(true)
    const novoProjetoFatura = calcularProjetoFatura(
      new Date(formEditar.data_compra + 'T12:00:00'),
      diaVencimento,
      ajusteFechamento
    )
    const { error } = await supabase
      .from('transacoes_nubank')
      .update({
        descricao: formEditar.descricao.trim(),
        valor,
        responsavel: formEditar.responsavel,
        categoria: formEditar.categoria || null,
        categoria_origem: formEditar.categoria ? 'MANUAL' : null,
        categoria_confianca: formEditar.categoria ? 1 : null,
        data: formEditar.data_compra,
        projeto_fatura: novoProjetoFatura,
      })
      .eq('hash_linha', modalEditar.hash_linha)

    setSalvando(false)
    if (error) { console.error('[salvarEdicao]', error); showToast(error.message || 'Erro ao salvar', 'erro'); return }

    log('editar', 'transacoes_nubank',
      `Editado: ${formEditar.descricao.trim()} — R$ ${valor.toFixed(2)} (${formEditar.responsavel})`,
      valor,
      modalEditar.valor
    )
    showToast('Compra atualizada!')
    setModalEditar(null)
    carregarCompras()
  }

  async function confirmarExclusao() {
    if (!modalExcluir) return
    setSalvando(true)
    const { error } = await supabase
      .from('transacoes_nubank')
      .delete()
      .eq('hash_linha', modalExcluir.hash_linha)

    setSalvando(false)
    if (error) { showToast('Erro ao excluir', 'erro'); return }

    log('excluir', 'transacoes_nubank',
      `Excluído: ${modalExcluir.descricao} — R$ ${modalExcluir.valor.toFixed(2)} (${modalExcluir.responsavel})`,
      modalExcluir.valor
    )
    showToast('Compra excluída')
    setModalExcluir(null)
    carregarCompras()
  }

  const filtrosAtivos = !!filtroResponsavel || !!filtroCartao || !!filtroDescricao || !!filtroValorMin || !!filtroDia || !!filtroCategoria

  function handleFiltroDescricaoChange(value: string) {
    setFiltroDescricaoInput(value)
    if (filtroDescricaoTimer.current) clearTimeout(filtroDescricaoTimer.current)
    filtroDescricaoTimer.current = setTimeout(() => setFiltroDescricao(value), 300)
  }

  function limparFiltros() {
    setFiltroResponsavel('')
    setFiltroCartao('')
    setFiltroDescricaoInput('')
    setFiltroDescricao('')
    setFiltroValorMin('')
    setFiltroDia('')
    setFiltroCategoria('')
  }

  const comprasFiltradas = useMemo(() => {
    return compras.filter((c) => {
      const dataStr = dataEfetiva(c)
      const diaCompra = dataStr ? Number(dataStr.substring(8, 10)) : null
      return (
        (!filtroResponsavel || c.responsavel === filtroResponsavel) &&
        (!filtroCartao || c.cartao === filtroCartao) &&
        (!filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())) &&
        (!filtroValorMin || c.valor >= Number(filtroValorMin)) &&
        (!filtroDia || diaCompra === Number(filtroDia)) &&
        (!filtroCategoria || c.categoria === filtroCategoria)
      )
    })
  }, [compras, filtroResponsavel, filtroCartao, filtroDescricao, filtroValorMin, filtroDia, filtroCategoria])

  const grupos = useMemo(() => {
    const map = new Map<string, Compra[]>()
    for (const c of comprasFiltradas) {
      const key = dataEfetiva(c) || 'sem-data'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [comprasFiltradas])

  const comprasSemFiltroResponsavel = useMemo(() => {
    return compras.filter((c) => {
      const dataStr = dataEfetiva(c)
      const diaCompra = dataStr ? Number(dataStr.substring(8, 10)) : null
      return (
        (!filtroCartao || c.cartao === filtroCartao) &&
        (!filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())) &&
        (!filtroValorMin || c.valor >= Number(filtroValorMin)) &&
        (!filtroDia || diaCompra === Number(filtroDia)) &&
        (!filtroCategoria || c.categoria === filtroCategoria)
      )
    })
  }, [compras, filtroCartao, filtroDescricao, filtroValorMin, filtroDia, filtroCategoria])

  const total = useMemo(() => comprasSemFiltroResponsavel.reduce((acc, c) => acc + c.valor, 0), [comprasSemFiltroResponsavel])
  const totalMatheus = useMemo(() => comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Matheus').reduce((acc, c) => acc + c.valor, 0), [comprasSemFiltroResponsavel])
  const totalJeniffer = useMemo(() => comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Jeniffer').reduce((acc, c) => acc + c.valor, 0), [comprasSemFiltroResponsavel])

  // Troca de mês: recarrega dados laterais (compras já cobertas pelo useDataSync)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    verificarFaturaFechada()
    carregarLabelsCartao()
  }, [mesAtualKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregarCategorias(); carregarLabelsCartao(); verificarFaturaFechada() }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-float ${
          toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="sticky top-0 sticky-header pt-3 pb-3 px-0 z-[10]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">Compras</h1>
        </div>
        <MonthSelector
          value={mesGlobal}
          onChange={setMesAtual}
        />
      </div>

      {/* Filtro de cartão */}
      <div className="flex gap-1.5 mb-3">
        {([
          ['', 'Todos'],
          ['nubank', cartaoLabels.nubank],
          ['cartao1', cartaoLabels.cartao1],
          ['cartao2', cartaoLabels.cartao2],
        ] as [string, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFiltroCartao(val as '' | 'nubank' | 'cartao1' | 'cartao2')}
            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all active:scale-95 ${
              filtroCartao === val
                ? val === '' ? 'bg-gray-800 text-white shadow-sm'
                  : val === 'nubank' ? 'bg-purple-600 text-white shadow-sm'
                  : val === 'cartao1' ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-pink-500 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-500 shadow-card'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros secundários — colapsáveis */}
      <div className="mb-3">
        <button
          onClick={() => setFiltrosExpandidos(v => !v)}
          className={`w-full flex items-center justify-between bg-white border rounded-2xl px-3 py-2.5 text-sm shadow-card transition-colors ${
            filtrosAtivos ? 'border-primary-200 text-primary-600' : 'border-gray-100 text-gray-500'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            <SlidersHorizontal className="w-4 h-4" />
            Filtros
            {filtrosAtivos && (
              <span className="bg-primary-100 text-primary-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                ativos
              </span>
            )}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${filtrosExpandidos ? 'rotate-180' : ''}`} />
        </button>

        {filtrosExpandidos && (
          <div className="bg-white rounded-b-2xl border border-t-0 border-gray-100 shadow-card px-3 pb-3 pt-2 grid grid-cols-2 gap-2 mt-0">
            <input
              type="text"
              className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              placeholder="Buscar por descrição…"
              value={filtroDescricaoInput}
              onChange={(e) => handleFiltroDescricaoChange(e.target.value)}
            />
            <select
              className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
            >
              <option value="">Categoria (todas)</option>
              {categorias.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              placeholder="Valor mínimo"
              value={filtroValorMin}
              onChange={(e) => setFiltroValorMin(numericOnly(e.target.value))}
            />
            <input
              type="number"
              min="1"
              max="31"
              className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              placeholder="Dia"
              value={filtroDia}
              onChange={(e) => setFiltroDia(e.target.value)}
            />
            {filtrosAtivos && (
              <button
                onClick={limparFiltros}
                className="col-span-2 text-xs text-red-500 hover:text-red-700 py-1 font-semibold transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Resumo / Filtro de responsável */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <button
          onClick={() => setFiltroResponsavel('')}
          className={`rounded-2xl p-3 text-center transition-all duration-200 active:scale-[0.97] ${
            filtroResponsavel === ''
              ? 'bg-gradient-to-br from-primary-500 to-primary-700 shadow-md ring-2 ring-primary-300 ring-offset-1'
              : 'bg-white border border-primary-100 shadow-card'
          }`}
        >
          <p className={`text-[11px] mb-0.5 font-medium ${filtroResponsavel === '' ? 'text-primary-100' : 'text-primary-500'}`}>Total</p>
          <p className={`text-sm font-bold num ${filtroResponsavel === '' ? 'text-white' : 'text-primary-700'}`}>R$ {total.toFixed(2)}</p>
          <p className={`text-[10px] ${filtroResponsavel === '' ? 'text-primary-200' : 'text-primary-400'}`}>{comprasSemFiltroResponsavel.length} itens</p>
        </button>
        <button
          onClick={() => setFiltroResponsavel(filtroResponsavel === 'Matheus' ? '' : 'Matheus')}
          className={`rounded-2xl p-3 text-center transition-all duration-200 active:scale-[0.97] ${
            filtroResponsavel === 'Matheus'
              ? 'bg-blue-600 shadow-md ring-2 ring-blue-300 ring-offset-1'
              : 'bg-white border border-blue-100 shadow-card'
          }`}
        >
          <p className={`text-[11px] mb-0.5 font-medium ${filtroResponsavel === 'Matheus' ? 'text-blue-100' : 'text-blue-400'}`}>Matheus</p>
          <p className={`text-sm font-bold num ${filtroResponsavel === 'Matheus' ? 'text-white' : 'text-blue-700'}`}>R$ {totalMatheus.toFixed(2)}</p>
          <p className={`text-[10px] ${filtroResponsavel === 'Matheus' ? 'text-blue-200' : 'text-blue-400'}`}>{comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Matheus').length}x</p>
        </button>
        <button
          onClick={() => setFiltroResponsavel(filtroResponsavel === 'Jeniffer' ? '' : 'Jeniffer')}
          className={`rounded-2xl p-3 text-center transition-all duration-200 active:scale-[0.97] ${
            filtroResponsavel === 'Jeniffer'
              ? 'bg-pink-500 shadow-md ring-2 ring-pink-300 ring-offset-1'
              : 'bg-white border border-pink-100 shadow-card'
          }`}
        >
          <p className={`text-[11px] mb-0.5 font-medium ${filtroResponsavel === 'Jeniffer' ? 'text-pink-100' : 'text-pink-400'}`}>Jeniffer</p>
          <p className={`text-sm font-bold num ${filtroResponsavel === 'Jeniffer' ? 'text-white' : 'text-pink-600'}`}>R$ {totalJeniffer.toFixed(2)}</p>
          <p className={`text-[10px] ${filtroResponsavel === 'Jeniffer' ? 'text-pink-200' : 'text-pink-400'}`}>{comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Jeniffer').length}x</p>
        </button>
      </div>

      {/* Banner de offline */}
      {!isOnline && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-3 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-sm text-blue-700 font-medium">Você está offline — edição desabilitada</p>
        </div>
      )}

      {/* Banner de fatura fechada */}
      {faturaFechada && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700 font-medium">Fatura paga — inclusão de novas compras bloqueada</p>
        </div>
      )}

      {/* Lista agrupada por data */}
      {loading ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-card divide-y">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="p-4 flex items-center gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded-xl w-3/4" />
                <div className="h-2.5 bg-gray-100 rounded-xl w-1/2" />
              </div>
              <div className="h-4 bg-gray-200 rounded-xl w-16" />
            </div>
          ))}
        </div>
      ) : grupos.length === 0 ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-card">
          <EmptyState
            icon={ShoppingBag}
            title="Nenhuma compra encontrada"
            description={filtrosAtivos ? 'Tente remover os filtros aplicados' : 'As compras importadas aparecerão aqui'}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(([dateKey, items]) => {
            const subtotal = items.reduce((acc, c) => acc + c.valor, 0)
            return (
              <div key={dateKey} className="bg-white rounded-3xl border border-gray-100 shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-500 capitalize">
                    {formatarCabecalhoData(dateKey)}
                  </span>
                  <span className="text-xs font-semibold text-gray-700 num">
                    R$ {subtotal.toFixed(2)}
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {items.map((c) => {
                    const isParcelado = c.parcela_atual && c.total_parcelas
                    return (
                      <div
                        key={c.hash_linha}
                        className={`px-3 py-3.5 flex items-center gap-3 transition-colors active:bg-gray-50 ${
                          c.responsavel === 'Matheus'
                            ? 'border-l-4 border-l-blue-400'
                            : c.responsavel === 'Jeniffer'
                              ? 'border-l-4 border-l-pink-400'
                              : 'border-l-4 border-l-gray-200'
                        }`}
                      >
                        <Avatar responsavel={c.responsavel} />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate leading-tight">
                            {c.descricao}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {c.categoria && <CategoriaBadge categoria={c.categoria} />}
                            <CartaoBadge cartao={c.cartao} labels={cartaoLabels} />
                            {isParcelado && (
                              <span className="inline-block text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                                {c.parcela_atual}/{c.total_parcelas}x
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-gray-800 num">R$ {c.valor.toFixed(2)}</p>
                        </div>

                        {!faturaFechada && isOnline && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => abrirEditar(c)}
                              className="p-2 rounded-xl text-primary-500 hover:bg-primary-50 active:bg-primary-100 transition-colors"
                              aria-label="Editar"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setModalExcluir(c)}
                              className="p-2 rounded-xl text-red-400 hover:bg-red-50 active:bg-red-100 transition-colors"
                              aria-label="Excluir"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: editar compra */}
      {modalEditar && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">Editar Compra</h3>
              <button onClick={() => setModalEditar(null)} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition-all hover:rotate-90 duration-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Descrição</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                  value={formEditar.descricao}
                  onChange={(e) => setFormEditar(f => ({ ...f, descricao: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                  placeholder="0,00"
                  value={formEditar.valor}
                  onChange={(e) => setFormEditar(f => ({ ...f, valor: numericOnly(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Responsável</label>
                <div className="flex gap-2">
                  {['Matheus', 'Jeniffer'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormEditar(f => ({ ...f, responsavel: r }))}
                      className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97] border ${
                        formEditar.responsavel === r
                          ? r === 'Matheus'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-pink-500 text-white border-pink-500 shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Categoria</label>
                <select
                  className="w-full border border-gray-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow bg-white"
                  value={formEditar.categoria}
                  onChange={(e) => setFormEditar(f => ({ ...f, categoria: e.target.value }))}
                >
                  <option value="">Sem categoria</option>
                  {categorias.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Data da compra</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                  value={formEditar.data_compra}
                  onChange={(e) => setFormEditar(f => ({ ...f, data_compra: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setModalEditar(null)}
                className="flex-1 py-3 rounded-2xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={salvando}
                className="flex-1 py-3 rounded-2xl bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50 transition-all active:scale-[0.97] shadow-sm"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: excluir compra */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-center mb-1">Excluir compra?</h3>
            <p className="text-sm text-gray-500 text-center mb-1">
              <span className="font-semibold text-gray-800">{modalExcluir.descricao}</span>
            </p>
            <p className="text-sm text-gray-400 text-center mb-6">
              <span className="num">R$ {modalExcluir.valor.toFixed(2)}</span> · {modalExcluir.responsavel}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setModalExcluir(null)}
                className="flex-1 py-3 rounded-2xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarExclusao}
                disabled={salvando}
                className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-50 transition-all active:scale-[0.97] shadow-sm"
              >
                {salvando ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
