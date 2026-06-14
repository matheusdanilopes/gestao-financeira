'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalSync } from '@/lib/useGlobalSync'
import { SwipeableItem } from '@/components/SwipeableItem'
import { Trash2, X, ShoppingBag, Lock, WifiOff, SlidersHorizontal, Calendar, Search } from 'lucide-react'
import MonthSelector from '@/components/MonthSelector'
import EmptyState from '@/components/EmptyState'
import { addMonths, subMonths, format, startOfMonth, isToday, isYesterday, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { log, numericOnly, formatBRL } from '@/lib/logger'
import { useMes } from '@/components/MesProvider'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'
import { calcularProjetoFatura } from '@/lib/fatura'

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
  created_at?: string
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

function getCartaoColors(val: string, labels: Record<string, string>) {
  const label = (labels[val] || val).toLowerCase()
  if (label.includes('picpay'))  return { border: 'border-l-green-500',  chip: 'bg-green-500 text-white' }
  if (label.includes('conjunto')) return { border: 'border-l-pink-400',   chip: 'bg-pink-400 text-white' }
  if (label.includes('jeniffer') || label.includes('jennifer'))
                                  return { border: 'border-l-violet-500', chip: 'bg-violet-500 text-white' }
  if (label.includes('nubank') || val === 'nubank')
                                  return { border: 'border-l-blue-500',   chip: 'bg-blue-500 text-white' }
  return { border: 'border-l-gray-200', chip: 'bg-gray-600 text-white' }
}

function getCartaoBorderColor(cartao: string | undefined, labels: Record<string, string>): string {
  if (!cartao) return 'border-l-gray-200'
  return getCartaoColors(cartao, labels).border
}


const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

export default function ComprasPage() {
  const { mesAtual: mesGlobal, setMesAtual } = useMes()
  const mesAtual = addMonths(mesGlobal, 1)
  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM')

  // Parâmetros de deep link vindos da notificação de importação
  const searchParams = useSearchParams()
  const importCartao = searchParams.get('cartao')
  const importDia = searchParams.get('dia')
  const importMes = searchParams.get('mes')   // YYYY-MM
  const importTs = searchParams.get('ts')     // Date.now() do momento da importação

  const [compras, setCompras] = useState<Compra[]>([])
  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [filtroCartao, setFiltroCartao] = useState<'' | 'nubank' | 'cartao1' | 'cartao2'>('')
  const [filtroDescricaoInput, setFiltroDescricaoInput] = useState('')
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const filtroDescricaoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroData, setFiltroData] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroParcelamento, setFiltroParcelamento] = useState<'' | 'avista' | 'parcelado'>('')
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

  // Ref para garantir que o contexto de deep link só é aplicado uma vez na montagem
  const importContextApplied = useRef(false)
  // Ref para o primeiro item importado (usado no auto-scroll)
  const firstImportedRef = useRef<HTMLDivElement | null>(null)
  const hasScrolled = useRef(false)

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
  const { isOnline, status, refetch } = useGlobalSync({
    cacheKey: `compras:${mesRefStr}`,
    tables: ['transacoes_nubank'],
    fetcher: fetcherCompras,
    onData: (data: unknown) => { setCompras(data as Compra[]) },
    pollInterval: 45_000,
  })
  const loading = status === 'loading'

  const isFirstRender = useRef(true)

  // Aplica filtros contextuais vindos do deep link da notificação de importação.
  // Executado apenas uma vez na montagem para não sobrescrever escolhas do usuário.
  useEffect(() => {
    if (importContextApplied.current) return
    if (!importCartao && !importDia && !importMes) return
    importContextApplied.current = true

    if (importCartao && (CARTOES_VALIDOS as readonly string[]).includes(importCartao)) {
      setFiltroCartao(importCartao as CartaoValido)
    }
    if (importDia) {
      const mes = importMes || format(mesAtual, 'yyyy-MM')
      setFiltroData(`${mes}-${importDia.padStart(2, '0')}`)
      setFiltrosExpandidos(true)
    }
    if (importMes) {
      // mesGlobal = mesAtual - 1; mesAtual é o mês exibido na tela
      const targetMesAtual = startOfMonth(parseISO(importMes + '-01'))
      const targetMesGlobal = subMonths(targetMesAtual, 1)
      setMesAtual(targetMesGlobal)
    }
  }, [importCartao, importDia, importMes, setMesAtual]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compras recém-importadas: criadas dentro de uma janela de ±10 min em torno do importTs.
  const isRecentlyImported = useCallback((c: Compra): boolean => {
    if (!importTs || !c.created_at) return false
    const ts = parseInt(importTs, 10)
    if (isNaN(ts)) return false
    const createdAt = new Date(c.created_at).getTime()
    // Janela: 5 min antes do ts (transações inseridas antes do push) até 15 min depois (importações longas)
    return createdAt >= ts - 5 * 60 * 1000 && createdAt <= ts + 15 * 60 * 1000
  }, [importTs])

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
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
    refetch()
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
    refetch()
  }

  const filtrosAtivos = !!filtroResponsavel || !!filtroCartao || !!filtroDescricao || !!filtroValorMin || !!filtroData || !!filtroCategoria || !!filtroParcelamento

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
    setFiltroData('')
    setFiltroCategoria('')
    setFiltroParcelamento('')
  }

  const comprasFiltradas = useMemo(() => {
    return compras.filter((c) => {
      const dataStr = dataEfetiva(c)
      return (
        (!filtroResponsavel || c.responsavel === filtroResponsavel) &&
        (!filtroCartao || c.cartao === filtroCartao) &&
        (!filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())) &&
        (!filtroValorMin || c.valor >= Number(filtroValorMin)) &&
        (!filtroData || dataStr === filtroData) &&
        (!filtroCategoria || c.categoria === filtroCategoria) &&
        (!filtroParcelamento ||
          (filtroParcelamento === 'avista' && (c.total_parcelas === null || c.total_parcelas <= 1)) ||
          (filtroParcelamento === 'parcelado' && c.total_parcelas !== null && c.total_parcelas > 1)
        )
      )
    })
  }, [compras, filtroResponsavel, filtroCartao, filtroDescricao, filtroValorMin, filtroData, filtroCategoria, filtroParcelamento])

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
      return (
        (!filtroCartao || c.cartao === filtroCartao) &&
        (!filtroDescricao || c.descricao.toLowerCase().includes(filtroDescricao.toLowerCase())) &&
        (!filtroValorMin || c.valor >= Number(filtroValorMin)) &&
        (!filtroData || dataStr === filtroData) &&
        (!filtroCategoria || c.categoria === filtroCategoria) &&
        (!filtroParcelamento ||
          (filtroParcelamento === 'avista' && (c.total_parcelas === null || c.total_parcelas <= 1)) ||
          (filtroParcelamento === 'parcelado' && c.total_parcelas !== null && c.total_parcelas > 1)
        )
      )
    })
  }, [compras, filtroCartao, filtroDescricao, filtroValorMin, filtroData, filtroCategoria, filtroParcelamento])

  const total = useMemo(() => comprasSemFiltroResponsavel.reduce((acc, c) => acc + c.valor, 0), [comprasSemFiltroResponsavel])
  const totalMatheus = useMemo(() => comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Matheus').reduce((acc, c) => acc + c.valor, 0), [comprasSemFiltroResponsavel])
  const totalJeniffer = useMemo(() => comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Jeniffer').reduce((acc, c) => acc + c.valor, 0), [comprasSemFiltroResponsavel])

  // Hash da primeira compra importada na lista visível (para scroll e ref)
  const firstImportedHash = useMemo(() => {
    if (!importTs) return null
    for (const [, items] of grupos) {
      for (const c of items) {
        if (isRecentlyImported(c)) return c.hash_linha
      }
    }
    return null
  }, [grupos, importTs, isRecentlyImported])

  // Auto-scroll até a primeira compra importada após os dados carregarem
  useEffect(() => {
    if (!firstImportedHash || hasScrolled.current || loading) return
    const elem = firstImportedRef.current
    if (!elem) return
    hasScrolled.current = true
    const timer = setTimeout(() => {
      elem.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
    return () => clearTimeout(timer)
  }, [firstImportedHash, loading])

  // Troca de mês: recarrega dados laterais (compras já cobertas pelo useDataSync)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    verificarFaturaFechada()
    carregarLabelsCartao()
  }, [mesAtualKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregarCategorias(); carregarLabelsCartao(); verificarFaturaFechada() }, []) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="min-h-screen bg-gray-50 page-content page-bottom-safe">

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold shadow-float transition-all ${
          toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-[10]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">Compras</h1>
        </div>
        <MonthSelector
          value={mesGlobal}
          onChange={setMesAtual}
        />
      </div>

      {/* Filtros: container dark com chips de cartão + campos de filtro */}
      <div className="bg-gray-800 rounded-2xl p-3 mb-3 space-y-2.5">
        {/* Tab chips + botão Filtros */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 flex-1 overflow-x-auto scrollbar-hide">
            {([
              ['', 'Todos'],
              ['nubank', cartaoLabels.nubank],
              ['cartao1', cartaoLabels.cartao1],
              ['cartao2', cartaoLabels.cartao2],
            ] as [string, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFiltroCartao(val as '' | 'nubank' | 'cartao1' | 'cartao2')}
                className={`shrink-0 py-1.5 px-3 text-[11px] font-semibold rounded-xl transition-all active:scale-95 truncate ${
                  filtroCartao === val
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setFiltrosExpandidos(v => !v)}
            className={`shrink-0 flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.97] ${
              filtrosAtivos
                ? 'bg-primary-500/30 text-primary-300'
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtros
          </button>
        </div>

        {filtrosExpandidos && (
          <div className="space-y-2">
            {/* Busca */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                className="w-full bg-gray-700 border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                placeholder="Buscar por descrição..."
                value={filtroDescricaoInput}
                onChange={(e) => handleFiltroDescricaoChange(e.target.value)}
              />
            </div>

            {/* Categoria */}
            <select
              className="w-full bg-gray-700 border border-transparent rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
            >
              <option value="">Categoria (todas)</option>
              {categorias.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            {/* Parcelamento */}
            <select
              className="w-full bg-gray-700 border border-transparent rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              value={filtroParcelamento}
              onChange={(e) => setFiltroParcelamento(e.target.value as '' | 'avista' | 'parcelado')}
            >
              <option value="">Parcelamento (todos)</option>
              <option value="avista">À vista</option>
              <option value="parcelado">Parcelado</option>
            </select>

            {/* Valor mínimo + Data */}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                inputMode="decimal"
                className="bg-gray-700 border border-transparent rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                placeholder="Valor mínimo"
                value={filtroValorMin}
                onChange={(e) => setFiltroValorMin(numericOnly(e.target.value))}
              />
              <div className="relative">
                <input
                  type="date"
                  className="w-full bg-gray-700 border border-transparent rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow appearance-none"
                  value={filtroData}
                  onChange={(e) => setFiltroData(e.target.value)}
                />
                {!filtroData && (
                  <div className="absolute inset-0 flex items-center gap-1.5 px-3 pointer-events-none">
                    <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-400">Data</span>
                  </div>
                )}
              </div>
            </div>

            {filtrosAtivos && (
              <button
                onClick={limparFiltros}
                className="w-full text-xs text-red-400 hover:text-red-300 py-1 font-semibold transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Resumo / Filtro de responsável — compacto */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <button
          onClick={() => setFiltroResponsavel('')}
          className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
            filtroResponsavel === ''
              ? 'bg-primary-50 border-primary-200'
              : 'bg-white border-gray-100'
          }`}
        >
          <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === '' ? 'text-primary-500' : 'text-gray-400'}`}>Total</p>
          <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === '' ? 'text-primary-700' : 'text-gray-700'}`}>{formatBRL(total)}</p>
          <p className={`text-[9px] mt-0.5 ${filtroResponsavel === '' ? 'text-primary-400' : 'text-gray-400'}`}>{comprasSemFiltroResponsavel.length} itens</p>
        </button>
        <button
          onClick={() => setFiltroResponsavel(filtroResponsavel === 'Matheus' ? '' : 'Matheus')}
          className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
            filtroResponsavel === 'Matheus'
              ? 'bg-blue-50 border-blue-200'
              : 'bg-white border-gray-100'
          }`}
        >
          <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === 'Matheus' ? 'text-blue-500' : 'text-gray-400'}`}>Matheus</p>
          <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === 'Matheus' ? 'text-blue-700' : 'text-gray-700'}`}>{formatBRL(totalMatheus)}</p>
          <p className={`text-[9px] mt-0.5 ${filtroResponsavel === 'Matheus' ? 'text-blue-400' : 'text-gray-400'}`}>{comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Matheus').length}x</p>
        </button>
        <button
          onClick={() => setFiltroResponsavel(filtroResponsavel === 'Jeniffer' ? '' : 'Jeniffer')}
          className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
            filtroResponsavel === 'Jeniffer'
              ? 'bg-pink-50 border-pink-200'
              : 'bg-white border-gray-100'
          }`}
        >
          <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === 'Jeniffer' ? 'text-pink-500' : 'text-gray-400'}`}>Jeniffer</p>
          <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === 'Jeniffer' ? 'text-pink-600' : 'text-gray-700'}`}>{formatBRL(totalJeniffer)}</p>
          <p className={`text-[9px] mt-0.5 ${filtroResponsavel === 'Jeniffer' ? 'text-pink-400' : 'text-gray-400'}`}>{comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Jeniffer').length}x</p>
        </button>
      </div>

      {/* Banner de contexto de importação */}
      {importTs && firstImportedHash && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-3 mb-3 flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-green-600 shrink-0" />
          <p className="text-sm text-green-700 font-medium flex-1">Compras recém-importadas destacadas abaixo</p>
          <button
            onClick={limparFiltros}
            className="text-xs text-green-600 font-semibold hover:text-green-800 transition-colors shrink-0"
          >
            Limpar
          </button>
        </div>
      )}

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
        <div className="space-y-3">
          {[0, 1].map(g => (
            <div key={g} className="bg-white rounded-3xl border border-gray-100 shadow-card overflow-hidden animate-pulse">
              {/* Cabeçalho de grupo skeleton */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <div className="h-3 bg-gray-200 rounded-lg w-28" />
                <div className="h-3 bg-gray-100 rounded-lg w-16" />
              </div>
              {/* Linhas skeleton */}
              {[1, 2, 3].map(i => (
                <div key={i} className="px-4 py-3.5 flex items-center gap-3 border-l-4 border-l-gray-100 border-b border-gray-50 last:border-b-0">
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-100 rounded-xl" style={{ width: `${55 + (i * 13) % 30}%` }} />
                    <div className="h-2.5 bg-gray-50 rounded-xl w-2/5" />
                  </div>
                  <div className="h-4 bg-gray-100 rounded-xl w-16" />
                </div>
              ))}
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
                    {formatBRL(subtotal)}
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {items.map((c) => {
                    const isParcelado = c.parcela_atual && c.total_parcelas
                    const canInteract = !faturaFechada && isOnline
                    const borderColor = getCartaoBorderColor(c.cartao, cartaoLabels)
                    const recentlyImported = isRecentlyImported(c)
                    const isFirst = c.hash_linha === firstImportedHash
                    const metaParts = [
                      c.responsavel,
                      isParcelado ? `${c.parcela_atual}/${c.total_parcelas}x` : null,
                      c.categoria || null,
                    ].filter(Boolean) as string[]
                    return (
                      <SwipeableItem
                        key={c.hash_linha}
                        onDelete={() => setModalExcluir(c)}
                        disabled={!canInteract}
                      >
                        <div
                          ref={isFirst ? firstImportedRef : undefined}
                          className={`px-4 py-3.5 flex items-center gap-3 border-l-4 ${borderColor} transition-colors ${
                            recentlyImported
                              ? 'bg-green-50/60 dark:bg-green-900/10'
                              : 'bg-white'
                          } ${canInteract ? 'cursor-pointer active:bg-gray-50 hover:bg-gray-50/50' : 'cursor-default'}`}
                          onClick={() => { if (canInteract) abrirEditar(c) }}
                          role={canInteract ? 'button' : undefined}
                          aria-label={canInteract ? `Editar ${c.descricao}` : undefined}
                          tabIndex={canInteract ? 0 : undefined}
                          onKeyDown={canInteract ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirEditar(c) } } : undefined}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-semibold text-gray-900 leading-snug truncate">
                              {c.descricao}
                            </p>
                            {metaParts.length > 0 && (
                              <p className="text-xs text-gray-400 dark:text-gray-300 mt-0.5 leading-tight truncate">
                                {metaParts.join(' · ')}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <p className="text-[15px] font-bold text-gray-900 num">{formatBRL(c.valor)}</p>
                            {recentlyImported && (
                              <span className="text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full leading-none">
                                Nova
                              </span>
                            )}
                          </div>
                        </div>
                      </SwipeableItem>
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
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm lg:max-w-lg p-6 shadow-float modal-sheet sm:modal-center">
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
        </ModalPortal>
      )}

      {/* Modal: excluir compra */}
      {modalExcluir && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm lg:max-w-lg p-6 shadow-float modal-sheet sm:modal-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-center mb-1">Excluir compra?</h3>
            <p className="text-sm text-gray-500 text-center mb-1">
              <span className="font-semibold text-gray-800">{modalExcluir.descricao}</span>
            </p>
            <p className="text-sm text-gray-400 text-center mb-6">
              <span className="num">{formatBRL(modalExcluir.valor)}</span> · {modalExcluir.responsavel}
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
        </ModalPortal>
      )}

    </div>
  )
}
