'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import FilterSelect from '@/components/FilterSelect'
import { calcularProjetoFatura } from '@/lib/fatura'
import { AUTH_DISABLED } from '@/lib/authConfig'

type Compra = {
  id: string
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
  status?: string | null
  is_estorno?: boolean | null
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

// Postgres/PostgREST às vezes devolve timestamp sem offset de fuso; sem 'Z'/±hh:mm,
// o JS interpretaria a string como horário local (errado), então assumimos UTC.
function parseTimestamp(ts: string): Date {
  const temFuso = /Z$|[+-]\d{2}:?\d{2}$/.test(ts)
  return new Date(temFuso ? ts : `${ts}Z`)
}

function formatarHoraInclusao(c: Compra, dateKey: string): string {
  if (!c.created_at) return ''
  try {
    const criadoEm = parseTimestamp(c.created_at)
    if (!isToday(parseISO(dateKey))) return format(criadoEm, 'HH:mm')

    const diffMin = Math.max(0, Math.floor((Date.now() - criadoEm.getTime()) / 60000))
    if (diffMin < 1) return 'agora'
    if (diffMin < 60) return `há ${diffMin} min`
    const diffHoras = Math.floor(diffMin / 60)
    return `há ${diffHoras} ${diffHoras === 1 ? 'hora' : 'horas'}`
  } catch {
    return ''
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

// Janela máxima para considerar uma compra "nova" — evita marcar todo o histórico
// como novo para um usuário que não acessa a tela há muito tempo.
const JANELA_COMPRA_NOVA_MS = 24 * 60 * 60 * 1000

export default function ComprasPage() {
  const router = useRouter()
  const { mesAtual: mesGlobal, setMesAtual } = useMes()
  const mesAtual = addMonths(mesGlobal, 1)
  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM')

  // Parâmetros de deep link vindos da notificação de importação
  const searchParams = useSearchParams()
  const importCartao = searchParams.get('cartao')
  const importMes = searchParams.get('mes')   // YYYY-MM
  const importTs = searchParams.get('ts')     // Date.now() do momento da importação
  // ids de transações excedentes (notificação de divergência de fatura) a destacar
  const highlightParam = searchParams.get('highlight')
  const highlightIds = useMemo(
    () => (highlightParam ? highlightParam.split(',').filter(Boolean) : []),
    [highlightParam]
  )

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

  // Tag "Nova" individualizada por usuário. `ultimaVisualizacaoAnterior` é a última
  // vez que O USUÁRIO ATUAL visitou esta tela (undefined = ainda carregando, null =
  // nunca visitou). `tagsNovasVisiveis` controla o fade automático: a tag some depois
  // de um tempo em tela mesmo sem o usuário sair da página.
  const [ultimaVisualizacaoAnterior, setUltimaVisualizacaoAnterior] = useState<Date | null | undefined>(undefined)
  const [tagsNovasVisiveis, setTagsNovasVisiveis] = useState(true)

  // Ref para garantir que o contexto de deep link só é aplicado uma vez na montagem
  const importContextApplied = useRef(false)
  // Ref para o primeiro item importado (usado no auto-scroll)
  const firstImportedRef = useRef<HTMLDivElement | null>(null)
  const hasScrolled = useRef(false)
  const hasScrolledHighlight = useRef(false)
  const [highlightTimedOut, setHighlightTimedOut] = useState(false)

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

  // Navega ao mês correto vindo do deep link da notificação de importação.
  // Não aplica filtro automático de cartão/dia: a tela apresenta as compras novas
  // via tag "Nova" (individualizada por usuário — ver isCompraNova), sem restringir
  // a lista visível. O filtro de cartão só é aplicado no fluxo de destaque de
  // divergência de fatura (highlightParam), que precisa restringir a busca à
  // transação-alvo. Executado apenas uma vez na montagem para não sobrescrever
  // escolhas do usuário.
  useEffect(() => {
    if (importContextApplied.current) return
    if (!importCartao && !importMes && !highlightParam) return
    importContextApplied.current = true

    if (importCartao && (CARTOES_VALIDOS as readonly string[]).includes(importCartao)) {
      setFiltroCartao(importCartao as CartaoValido)
    }
    // Deep link de destaque (fatura_divergencia): reseta filtros "não relacionados"
    // que podem ter ficado ativos de uma navegação anterior na mesma sessão e
    // esconderiam silenciosamente a transação alvo.
    if (highlightParam) {
      setFiltroResponsavel('')
      setFiltroDescricaoInput('')
      setFiltroDescricao('')
      setFiltroValorMin('')
      setFiltroCategoria('')
      setFiltroParcelamento('')
      setFiltroData('')
    }
    if (importMes) {
      // mesGlobal = mesAtual - 1; mesAtual é o mês exibido na tela
      const targetMesAtual = startOfMonth(parseISO(importMes + '-01'))
      const targetMesGlobal = subMonths(targetMesAtual, 1)
      setMesAtual(targetMesGlobal)
    }
  }, [importCartao, importMes, highlightParam, setMesAtual])

  // Registra a visita do usuário atual à tela de Compras: lê a visualização anterior
  // (para saber o que era "novo" para ELE) e já grava o novo timestamp, garantindo
  // que a tag "Nova" não reapareça em acessos futuros — comportamento individualizado
  // por usuário (cada usuário tem sua própria linha em compras_ultima_visualizacao).
  useEffect(() => {
    let cancelado = false
    async function marcarVisualizacao() {
      let email = 'demo@demo.com'
      if (!AUTH_DISABLED) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user?.email) return
        email = session.user.email
      }
      const { data } = await supabase
        .from('compras_ultima_visualizacao')
        .select('visto_em')
        .eq('usuario', email)
        .maybeSingle()
      if (cancelado) return
      setUltimaVisualizacaoAnterior(data?.visto_em ? parseTimestamp(data.visto_em) : null)
      await supabase
        .from('compras_ultima_visualizacao')
        .upsert({ usuario: email, visto_em: new Date().toISOString() }, { onConflict: 'usuario' })
    }
    marcarVisualizacao()
    return () => { cancelado = true }
  }, [])

  // Fade automático: mesmo sem sair da tela, a tag "Nova" some depois de um tempo.
  useEffect(() => {
    if (ultimaVisualizacaoAnterior === undefined) return
    const timer = setTimeout(() => setTagsNovasVisiveis(false), 8_000)
    return () => clearTimeout(timer)
  }, [ultimaVisualizacaoAnterior])

  // Compra "nova" para o usuário atual: criada depois da última visita DELE a esta
  // tela (individualizado por usuário) e dentro da janela de segurança. Deixa de
  // valer quando tagsNovasVisiveis vira false (fade por tempo em tela).
  const isCompraNova = useCallback((c: Compra): boolean => {
    if (!tagsNovasVisiveis || !c.created_at || ultimaVisualizacaoAnterior === undefined) return false
    const createdAt = parseTimestamp(c.created_at).getTime()
    const limite = ultimaVisualizacaoAnterior ? ultimaVisualizacaoAnterior.getTime() : 0
    return createdAt > limite && createdAt > Date.now() - JANELA_COMPRA_NOVA_MS
  }, [tagsNovasVisiveis, ultimaVisualizacaoAnterior])

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
    for (const items of map.values()) {
      items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
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

  const semEstorno = useMemo(() => comprasSemFiltroResponsavel.filter(c => c.status !== 'ESTORNO' && c.status !== 'ESTORNADO'), [comprasSemFiltroResponsavel])
  const total = useMemo(() => semEstorno.reduce((acc, c) => acc + c.valor, 0), [semEstorno])
  const totalMatheus = useMemo(() => semEstorno.filter(c => c.responsavel === 'Matheus').reduce((acc, c) => acc + c.valor, 0), [semEstorno])
  const totalJeniffer = useMemo(() => semEstorno.filter(c => c.responsavel === 'Jeniffer').reduce((acc, c) => acc + c.valor, 0), [semEstorno])
  const totalConjunto = useMemo(() => semEstorno.filter(c => c.responsavel === 'Conjunto').reduce((acc, c) => acc + c.valor, 0), [semEstorno])

  // Hash da primeira compra nova na lista visível (para scroll e ref). Só é usado
  // para o auto-scroll/banner ao chegar via notificação (importTs presente); a tag
  // "Nova" em si (isCompraNova) independe de importTs.
  const firstImportedHash = useMemo(() => {
    if (!importTs) return null
    for (const [, items] of grupos) {
      for (const c of items) {
        if (isCompraNova(c)) return c.hash_linha
      }
    }
    return null
  }, [grupos, importTs, isCompraNova])

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

  // Entre os ids de destaque (notificação de fatura_divergencia), o primeiro que já
  // está presente entre as transações atualmente renderizadas/filtradas. Recalcula
  // sempre que `grupos` muda (nova página de dados chega, filtro muda), permitindo
  // re-tentativa automática sem depender do status de loading (evita a corrida com
  // cache stale-while-revalidate do useDataSync).
  const highlightTargetId = useMemo(() => {
    if (highlightIds.length === 0) return null
    const idsPresentes = new Set<string>()
    for (const [, items] of grupos) {
      for (const c of items) idsPresentes.add(c.id)
    }
    return highlightIds.find(id => idsPresentes.has(id)) ?? null
  }, [grupos, highlightIds])

  // Prazo para desistir de aguardar a transação de destaque aparecer (filtro
  // residual escondendo a linha, ou o id realmente não está nesta tela/mês).
  useEffect(() => {
    if (highlightIds.length === 0) return
    const timer = setTimeout(() => setHighlightTimedOut(true), 8_000)
    return () => clearTimeout(timer)
  }, [highlightIds])

  // Scroll até a transação excedente apontada pela notificação de divergência de
  // fatura. Data-driven: só finaliza quando `highlightTargetId` confirma que o id
  // está entre os dados/filtro atuais E o elemento já está no DOM (pós-commit),
  // ou quando o prazo de espera (highlightTimedOut) se esgota.
  useEffect(() => {
    if (highlightIds.length === 0 || hasScrolledHighlight.current) return
    const elem = highlightTargetId ? document.getElementById(`compra-${highlightTargetId}`) : null
    if (!elem && !highlightTimedOut) return // ainda não apareceu; espera novo render

    hasScrolledHighlight.current = true

    const scrollTimer = setTimeout(() => {
      if (elem) {
        elem.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        showToast('Transação não encontrada', 'erro')
      }
    }, 400)

    // Só limpa a URL rápido se desistimos sem achar nada; se achou, espera a
    // animação .animate-fatura-highlight (≈3.4s) terminar antes de remover o
    // parâmetro, para não cortar o destaque visual pela metade.
    const cleanupTimer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      params.delete('highlight')
      const query = params.toString()
      router.replace(query ? `/compras?${query}` : '/compras', { scroll: false })
    }, elem ? 3_800 : 400)

    return () => { clearTimeout(scrollTimer); clearTimeout(cleanupTimer) }
  }, [highlightIds, highlightTargetId, highlightTimedOut]) // eslint-disable-line react-hooks/exhaustive-deps

  // Troca de mês: recarrega dados laterais (compras já cobertas pelo useDataSync)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    verificarFaturaFechada()
    carregarLabelsCartao()
  }, [mesAtualKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregarCategorias(); carregarLabelsCartao(); verificarFaturaFechada() }, []) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="min-h-screen bg-gray-50 page-content page-bottom-safe page-enter">

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
          <div className="flex gap-1 flex-1 min-w-0">
            {([
              ['', 'Todos'],
              ['nubank', cartaoLabels.nubank],
              ['cartao1', cartaoLabels.cartao1],
              ['cartao2', cartaoLabels.cartao2],
            ] as [string, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFiltroCartao(val as '' | 'nubank' | 'cartao1' | 'cartao2')}
                className={`flex-1 min-w-0 py-1.5 text-[11px] font-semibold rounded-xl transition-all active:scale-95 truncate ${
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
            <FilterSelect
              value={filtroCategoria}
              onChange={v => setFiltroCategoria(v)}
              options={[
                { value: '', label: 'Categoria (todas)' },
                ...categorias.map(cat => ({ value: cat, label: cat })),
              ]}
            />

            {/* Parcelamento */}
            <FilterSelect
              value={filtroParcelamento}
              onChange={v => setFiltroParcelamento(v as '' | 'avista' | 'parcelado')}
              options={[
                { value: '',          label: 'Parcelamento (todos)' },
                { value: 'avista',    label: 'À vista'              },
                { value: 'parcelado', label: 'Parcelado'            },
              ]}
            />

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
      <div className="flex flex-col gap-1.5 mb-3">
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
        <div className="grid grid-cols-3 gap-1.5">
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
          <button
            onClick={() => setFiltroResponsavel(filtroResponsavel === 'Conjunto' ? '' : 'Conjunto')}
            className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
              filtroResponsavel === 'Conjunto'
                ? 'bg-purple-50 border-purple-200'
                : 'bg-white border-gray-100'
            }`}
          >
            <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === 'Conjunto' ? 'text-purple-500' : 'text-gray-400'}`}>Conjunto</p>
            <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === 'Conjunto' ? 'text-purple-700' : 'text-gray-700'}`}>{formatBRL(totalConjunto)}</p>
            <p className={`text-[9px] mt-0.5 ${filtroResponsavel === 'Conjunto' ? 'text-purple-400' : 'text-gray-400'}`}>{comprasSemFiltroResponsavel.filter(c => c.responsavel === 'Conjunto').length}x</p>
          </button>
        </div>
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
          {grupos.map(([dateKey, items], groupIdx) => {
            const subtotal = items.filter(c => c.status !== 'ESTORNO' && c.status !== 'ESTORNADO').reduce((acc, c) => acc + c.valor, 0)
            return (
              <div key={dateKey} className="bg-white rounded-3xl border border-gray-100 shadow-card overflow-hidden list-item-enter" style={{ animationDelay: `${Math.min(groupIdx, 3) * 40}ms` }}>
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
                    const isEstorno   = c.status === 'ESTORNO'
                    const isEstornado = c.status === 'ESTORNADO'
                    const borderColor = isEstorno
                      ? 'border-l-orange-400'
                      : isEstornado
                        ? 'border-l-gray-300'
                        : getCartaoBorderColor(c.cartao, cartaoLabels)
                    const compraNova = isCompraNova(c)
                    const isFirst = c.hash_linha === firstImportedHash
                    const isHighlighted = highlightIds.includes(c.id)
                    const metaParts = [
                      c.responsavel,
                      isParcelado ? `${c.parcela_atual}/${c.total_parcelas}x` : null,
                      c.categoria || null,
                    ].filter(Boolean) as string[]
                    const horaInclusao = formatarHoraInclusao(c, dateKey)
                    return (
                      <SwipeableItem
                        key={c.hash_linha}
                        onDelete={() => setModalExcluir(c)}
                        disabled={!canInteract}
                      >
                        <div
                          id={`compra-${c.id}`}
                          ref={isFirst ? firstImportedRef : undefined}
                          className={`px-4 py-3.5 flex items-center gap-3 border-l-4 ${borderColor} transition-colors ${isHighlighted ? ' animate-fatura-highlight' : ''} ${
                            isEstornado
                              ? 'bg-gray-50/80 dark:bg-gray-800/50 opacity-60'
                              : isEstorno
                                ? 'bg-orange-50/40 dark:bg-orange-900/20'
                                : compraNova
                                  ? 'bg-green-50/60 dark:bg-green-900/10'
                                  : 'bg-white'
                          } ${canInteract ? 'cursor-pointer active:bg-gray-50 dark:active:bg-white/[0.06] hover:bg-gray-50/50 dark:hover:bg-white/[0.06]' : 'cursor-default'}`}
                          onClick={() => { if (canInteract) abrirEditar(c) }}
                          role={canInteract ? 'button' : undefined}
                          aria-label={canInteract ? `Editar ${c.descricao}` : undefined}
                          tabIndex={canInteract ? 0 : undefined}
                          onKeyDown={canInteract ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirEditar(c) } } : undefined}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-[15px] font-semibold leading-snug truncate ${isEstornado ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                              {c.descricao}
                            </p>
                            {metaParts.length > 0 && (
                              <p className="text-xs text-gray-400 dark:text-gray-300 mt-0.5 leading-tight truncate">
                                {metaParts.join(' · ')}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <p className={`text-[15px] font-bold num ${isEstorno ? 'text-orange-500' : isEstornado ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                              {isEstorno ? `+${formatBRL(c.valor)}` : formatBRL(c.valor)}
                            </p>
                            {horaInclusao && (
                              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-300 leading-none">
                                {horaInclusao}
                              </span>
                            )}
                            {isEstorno && (
                              <span className="text-[9px] font-bold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full leading-none">
                                Estorno
                              </span>
                            )}
                            {isEstornado && (
                              <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full leading-none">
                                Estornada
                              </span>
                            )}
                            {!isEstorno && !isEstornado && compraNova && (
                              <span className="text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full leading-none transition-opacity duration-500">
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
                  {(['Matheus', 'Jeniffer', 'Conjunto'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormEditar(f => ({ ...f, responsavel: r }))}
                      className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97] border ${
                        formEditar.responsavel === r
                          ? r === 'Matheus'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : r === 'Jeniffer'
                              ? 'bg-pink-500 text-white border-pink-500 shadow-sm'
                              : 'bg-purple-600 text-white border-purple-600 shadow-sm'
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
