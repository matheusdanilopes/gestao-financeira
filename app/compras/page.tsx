'use client'

import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalSync } from '@/lib/useGlobalSync'
import { Trash2, X, ShoppingBag, Lock, WifiOff, SlidersHorizontal, ChevronDown } from 'lucide-react'
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

function getCartaoBorderColor(cartao: string | undefined, labels: Record<string, string>): string {
  if (!cartao) return 'border-l-gray-200'
  const label = (labels[cartao] || cartao).toLowerCase()
  if (label.includes('picpay')) return 'border-l-green-500'
  if (label.includes('conjunto')) return 'border-l-pink-400'
  if (label.includes('jeniffer') || label.includes('jennifer')) return 'border-l-violet-500'
  if (cartao === 'nubank' || label.includes('nubank')) return 'border-l-blue-500'
  return 'border-l-gray-200'
}

const SWIPE_REVEAL_WIDTH = 72
const SWIPE_DELETE_THRESHOLD = -60

function SwipeableItem({
  children,
  onDelete,
  disabled = false,
}: {
  children: ReactNode
  onDelete: () => void
  disabled?: boolean
}) {
  const [translateX, setTranslateX] = useState(0)
  const [animating, setAnimating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const onDeleteRef = useRef(onDelete)

  useEffect(() => { onDeleteRef.current = onDelete })

  useEffect(() => {
    const el = containerRef.current
    if (!el || disabled) return

    let startX = 0, startY = 0
    let active = false
    let direction: 'h' | 'v' | null = null
    let currentDx = 0

    function onTouchStart(e: TouchEvent) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      active = true
      direction = null
      currentDx = 0
    }

    function onTouchMove(e: TouchEvent) {
      if (!active) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (direction === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        direction = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      }
      if (direction !== 'h' || dx >= 0) return
      e.preventDefault()
      currentDx = Math.max(dx, -SWIPE_REVEAL_WIDTH * 1.5)
      setTranslateX(currentDx)
      setAnimating(false)
    }

    function onTouchEnd() {
      if (!active) return
      const wasHorizontal = direction === 'h'
      active = false
      direction = null
      if (!wasHorizontal) return
      setAnimating(true)
      if (currentDx <= SWIPE_DELETE_THRESHOLD) {
        onDeleteRef.current()
      }
      setTranslateX(0)
      currentDx = 0
    }

    function onTouchCancel() {
      active = false
      direction = null
      currentDx = 0
      setAnimating(true)
      setTranslateX(0)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [disabled])

  const revealProgress = Math.min(Math.abs(translateX) / SWIPE_REVEAL_WIDTH, 1)

  return (
    <div ref={containerRef} className="relative overflow-hidden select-none">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500"
        style={{ width: SWIPE_REVEAL_WIDTH, opacity: revealProgress }}
      >
        <Trash2 className="w-5 h-5 text-white" />
      </div>
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          transition: animating ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
          willChange: translateX !== 0 ? 'transform' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default function ComprasPage() {
  const { mesAtual: mesGlobal, setMesAtual } = useMes()
  const mesAtual = addMonths(mesGlobal, 1)
  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM')

  const [compras, setCompras] = useState<Compra[]>([])
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
  const { isOnline, status, refetch } = useGlobalSync({
    cacheKey: `compras:${mesRefStr}`,
    tables: ['transacoes_nubank'],
    fetcher: fetcherCompras,
    onData: (data: unknown) => { setCompras(data as Compra[]) },
    pollInterval: 45_000,
  })
  const loading = status === 'loading'

  const isFirstRender = useRef(true)

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
    <div className="min-h-screen bg-gray-50 page-content page-bottom-safe">

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-float ${
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

      {/* Filtros: chips de cartão + toggle de filtros secundários na mesma linha */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1 flex-1">
          {([
            ['', 'Todos'],
            ['nubank', cartaoLabels.nubank],
            ['cartao1', cartaoLabels.cartao1],
            ['cartao2', cartaoLabels.cartao2],
          ] as [string, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFiltroCartao(val as '' | 'nubank' | 'cartao1' | 'cartao2')}
              className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-all active:scale-95 truncate ${
                filtroCartao === val
                  ? val === '' ? 'bg-gray-700 text-white'
                    : val === 'nubank' ? 'bg-blue-500 text-white'
                    : val === 'cartao1' ? 'bg-pink-400 text-white'
                    : 'bg-violet-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-400 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setFiltrosExpandidos(v => !v)}
          className={`shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg border text-[11px] font-medium transition-colors ${
            filtrosAtivos
              ? 'bg-primary-50 border-primary-200 text-primary-600'
              : 'bg-white border-gray-200 text-gray-400 dark:text-gray-300'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {filtrosAtivos ? 'Ativos' : 'Filtros'}
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${filtrosExpandidos ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {filtrosExpandidos && (
        <div className="bg-white rounded-xl border border-gray-100 px-3 pb-3 pt-2.5 grid grid-cols-2 gap-2 mb-2">
          <input
            type="text"
            className="bg-gray-50 border border-transparent rounded-lg p-2 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
            placeholder="Buscar por descrição…"
            value={filtroDescricaoInput}
            onChange={(e) => handleFiltroDescricaoChange(e.target.value)}
          />
          <select
            className="bg-gray-50 border border-transparent rounded-lg p-2 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
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
            className="bg-gray-50 border border-transparent rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
            placeholder="Valor mínimo"
            value={filtroValorMin}
            onChange={(e) => setFiltroValorMin(numericOnly(e.target.value))}
          />
          <input
            type="number"
            min="1"
            max="31"
            className="bg-gray-50 border border-transparent rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
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
            <div key={i} className="px-4 py-3.5 flex items-center gap-3 border-l-4 border-l-gray-200 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-gray-200 rounded-xl w-3/4" />
                <div className="h-2.5 bg-gray-100 rounded-xl w-2/5" />
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
                    {formatBRL(subtotal)}
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {items.map((c) => {
                    const isParcelado = c.parcela_atual && c.total_parcelas
                    const canInteract = !faturaFechada && isOnline
                    const borderColor = getCartaoBorderColor(c.cartao, cartaoLabels)
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
                          className={`px-4 py-3.5 flex items-center gap-3 border-l-4 ${borderColor} bg-white transition-colors ${canInteract ? 'cursor-pointer active:bg-gray-50 hover:bg-gray-50/50' : 'cursor-default'}`}
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
                          <div className="text-right shrink-0">
                            <p className="text-[15px] font-bold text-gray-900 num">{formatBRL(c.valor)}</p>
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
