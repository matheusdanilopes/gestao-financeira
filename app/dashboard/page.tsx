'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths, subMonths, isSameMonth } from 'date-fns'
import { calcularDataFechamentoDaFatura } from '@/lib/fatura'
import { AlertTriangle, BarChart2, BarChart3, CreditCard, Wallet, PiggyBank, TrendingUp, TrendingDown, Minus, LineChart, Activity } from 'lucide-react'
import { ptBR } from 'date-fns/locale'
import { useMes } from '@/components/MesProvider'
import MonthSelector from '@/components/MonthSelector'
import dynamic from 'next/dynamic'

const GraficoProjecao = dynamic(() => import('@/components/GraficoProjecao'), {
  ssr: false,
  loading: () => (
    <div className="h-72 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  ),
})

const GraficoEvolucaoMensal = dynamic(() => import('@/components/GraficoEvolucaoMensal'), {
  ssr: false,
  loading: () => (
    <div className="h-64 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  ),
})

const GraficoEvolucaoInvestimentos = dynamic(
  () => import('@/components/GraficoEvolucaoInvestimentos'),
  {
    ssr: false,
    loading: () => (
      <div className="h-56 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
      </div>
    ),
  }
)

const GraficoGastosDiarios = dynamic(() => import('@/components/GraficoGastosDiarios'), {
  ssr: false,
  loading: () => (
    <div className="h-48 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
    </div>
  ),
})

const CategoryTreemap = dynamic(() => import('@/components/CategoryTreemap'), { ssr: false })

const GraficoCategoriasDespesas = dynamic(
  () => import('@/components/GraficoCategoriasDespesas'),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    ),
  }
)
import { InfoPopover } from '@/components/InfoPopover'

const DrawerDetalhes = dynamic(() => import('@/components/DrawerDetalhes'), { ssr: false })
const PeriodSelectorSheet = dynamic(() => import('@/components/PeriodSelectorSheet'), { ssr: false })
const InsightsCard = dynamic(() => import('@/components/InsightsCard'), { ssr: false })
import { useGlobalSync } from '@/lib/useGlobalSync'
import { usePrefetchPages } from '@/lib/usePrefetchPages'
import { formatBRL as fmt } from '@/lib/logger'

const NUBANK_ITEMS = new Set(['NuBank Matheus', 'NuBank Jeniffer', 'NuBank Jeniffer Conjunto'])

interface CartaoItem {
  nome: string
  responsavel: string
  previsto: number
  pago: number
}

interface FaturaState {
  totalRealizado: number
  matheusAtual: number
  matheusPrevisto: number
  matheusProjecaoParcelas: number
  jenifferAtual: number
  jenifferPrevisto: number
  jenifferProjecaoParcelas: number
  sobraMatheus: number
  sobraJeniffer: number
  cartao1Items: CartaoItem[]
  cartao2Items: CartaoItem[]
  cartao1AtualMatheus: number
  cartao1AtualJeniffer: number
  cartao2AtualMatheus: number
  cartao2AtualJeniffer: number
  cartao1Previsto: number
  cartao2Previsto: number
  cartao1Nome: string
  cartao2Nome: string
}

interface ResumoCaixaState {
  receitaTotal: number
  contasFixas: number
  fatura: number
  faturaEhPrevisto: boolean
  extras: number
  totalGastos: number
  sobraLiquida: number
  saldoPrevisto: number
  percentualComprometimento: number
  todasDespesasPagas: boolean
}

interface DashboardData {
  fatura: FaturaState
  resumoCaixa: ResumoCaixaState
  investimentos: { id: string; descricao: string; percentual: number; aportado: number }[]
  assinaturasNaopagas: { matheus: number; jeniffer: number }
  dataFechamentoNubank: string | null
}


async function carregarDados(mes: Date): Promise<DashboardData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [
    { data: transacoesFatura },
    { data: planejamento },
    { data: invData },
    { data: transacoesC1 },
    { data: transacoesC2 },
    { data: nubankConfigs },
    { data: faturaRegistradaData },
    { data: assinaturasData },
    { data: maxFaturaRowData },
  ] = await Promise.all([
    supabase.from('transacoes_nubank').select('valor, responsavel, descricao').eq('projeto_fatura', mesRefFatura).eq('cartao', 'nubank'),
    supabase.from('planejamento').select('item, responsavel, valor_previsto, pago, valor_real').eq('mes_referencia', mesRef),
    supabase.from('investimentos').select('id, descricao, percentual').eq('mes_referencia', mesRef).order('created_at', { ascending: true }),
    supabase.from('transacoes_nubank').select('valor, responsavel').eq('cartao', 'cartao1').eq('projeto_fatura', mesRefFatura),
    supabase.from('transacoes_nubank').select('valor, responsavel').eq('cartao', 'cartao2').eq('projeto_fatura', mesRefFatura),
    supabase.from('configuracoes').select('chave, valor').in('chave', ['dia_vencimento', 'ajuste_fechamento']),
    supabase.from('faturas').select('data_fechamento').eq('cartao', 'nubank').eq('mes_referencia', mesRefFatura).limit(1),
    supabase.from('assinaturas').select('nome, valor, responsavel, ativa').eq('cartao', 'nubank'),
    supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'nubank')
      .lte('projeto_fatura', mesRefFatura).order('projeto_fatura', { ascending: false }).limit(1),
  ])

  const diaVencNubank = parseInt(nubankConfigs?.find((c: { chave: string; valor: string }) => c.chave === 'dia_vencimento')?.valor || '10')
  const ajusteNubank  = parseInt(nubankConfigs?.find((c: { chave: string; valor: string }) => c.chave === 'ajuste_fechamento')?.valor || '0')
  const mesRefFaturaDate = startOfMonth(addMonths(mes, 1))
  const dataFechamentoNubank = faturaRegistradaData?.[0]?.data_fechamento
    || format(calcularDataFechamentoDaFatura(mesRefFaturaDate, diaVencNubank, ajusteNubank), 'yyyy-MM-dd')

  const totalRealizado = transacoesFatura?.reduce((acc, t) => acc + t.valor, 0) || 0
  const matheusAtual = transacoesFatura?.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0) || 0
  const jenifferAtual = transacoesFatura?.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0) || 0

  const matheusPrevisto = planejamento?.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (planejamento?.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) +
    (planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)

  const toCartaoItem = (p: { item: string; responsavel: string | null; valor_previsto: number | null; valor_real: number | null }, prefixo: string): CartaoItem => ({
    nome: p.item.replace(prefixo, '').trim(),
    responsavel: p.responsavel || '',
    previsto: p.valor_previsto ?? 0,
    pago: p.valor_real ?? p.valor_previsto ?? 0,
  })

  const cartao1PlanejamentoItems: CartaoItem[] = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))
    .map(p => toCartaoItem(p, '[CARTAO1]'))

  const cartao2PlanejamentoItems: CartaoItem[] = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))
    .map(p => toCartaoItem(p, '[CARTAO2]'))

  const cartao1TotalMatheus = (transacoesC1 || []).filter(t => t.responsavel === 'Matheus').reduce((s, t) => s + t.valor, 0)
  const cartao1TotalJeniffer = (transacoesC1 || []).filter(t => t.responsavel === 'Jeniffer').reduce((s, t) => s + t.valor, 0)
  const cartao2TotalMatheus = (transacoesC2 || []).filter(t => t.responsavel === 'Matheus').reduce((s, t) => s + t.valor, 0)
  const cartao2TotalJeniffer = (transacoesC2 || []).filter(t => t.responsavel === 'Jeniffer').reduce((s, t) => s + t.valor, 0)

  const receitaBase = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
  const receitasExtras = planejamento
    ?.filter(p => typeof p.item === 'string' && p.item.startsWith('[RECEITA]'))
    .reduce((acc, p) => acc + p.valor_previsto, 0) || 0
  const receitaTotal = receitaBase + receitasExtras

  const totalPlanejado = (planejamento || [])
    .filter(p => {
      const item = typeof p.item === 'string' ? p.item : ''
      return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
    })
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

  const nuBankPrevisto = matheusPrevisto + jenifferPrevisto
  const faturaEhPrevisto = totalRealizado === 0

  let matheusProjecaoParcelas = 0
  let jenifferProjecaoParcelas = 0
  if (faturaEhPrevisto) {
    const mesProjecao = startOfMonth(addMonths(mes, 1))
    // maxFaturaRowData fetched ahead-of-time in the parallel Promise.all above

    if (maxFaturaRowData?.[0]?.projeto_fatura) {
      const { data: transacoesBase } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura, descricao, valor, responsavel, parcela_atual, total_parcelas')
        .eq('cartao', 'nubank').eq('projeto_fatura', maxFaturaRowData[0].projeto_fatura)

      const contratos = new Map<string, { fatura: Date; atual: number; total: number; valor: number; responsavel: string }>()

      for (const t of (transacoesBase || [])) {
        let atual: number, total: number
        if (t.parcela_atual && t.total_parcelas) {
          atual = Number(t.parcela_atual); total = Number(t.total_parcelas)
        } else {
          const descricao = String(t.descricao || '')
          const matchParcela = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
          if (matchParcela) { atual = Number(matchParcela[1]); total = Number(matchParcela[2]) }
          else {
            const matchSlash = descricao.match(/\b(\d{1,2})\/(\d{1,2})\b/)
            if (!matchSlash) continue
            atual = Number(matchSlash[1]); total = Number(matchSlash[2])
            if (total < 2) continue
          }
        }
        if (atual < 1 || total < atual) continue
        const descricao = String(t.descricao || '')
        const faturaDate = startOfMonth(new Date(t.projeto_fatura + 'T12:00:00'))
        const origem = subMonths(faturaDate, atual - 1)
        const descBase = descricao.replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '').replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '').trim().toLowerCase()
        const key = `${format(origem, 'yyyy-MM')}|${descBase}|${total}|${t.responsavel}`
        const existing = contratos.get(key)
        if (!existing || faturaDate > existing.fatura) {
          contratos.set(key, { fatura: faturaDate, atual, total, valor: t.valor, responsavel: t.responsavel })
        }
      }

      for (const { fatura: faturaDate, atual, total, valor, responsavel } of contratos.values()) {
        const deltaM = (mesProjecao.getFullYear() - faturaDate.getFullYear()) * 12 + (mesProjecao.getMonth() - faturaDate.getMonth())
        const parcelaNoMes = atual + deltaM
        if (parcelaNoMes >= 1 && parcelaNoMes <= total) {
          if (responsavel === 'Matheus') matheusProjecaoParcelas += valor
          if (responsavel === 'Jeniffer') jenifferProjecaoParcelas += valor
        }
      }
    }
  }

  const cartao1TotalAtual = cartao1TotalMatheus + cartao1TotalJeniffer
  const cartao2TotalAtual = cartao2TotalMatheus + cartao2TotalJeniffer
  const cartao1PrevTotal = cartao1PlanejamentoItems.reduce((s, i) => s + i.previsto, 0)
  const cartao2PrevTotal = cartao2PlanejamentoItems.reduce((s, i) => s + i.previsto, 0)

  // Payment-aware effective amounts per card.
  // Priority: payment amount (invoice paid) > actual transactions > planned budget.
  // This avoids counting both the individual purchases AND the invoice payment as separate expenses.
  const nubankMatheusRow = planejamento?.find(p => p.item === 'NuBank Matheus')
  const nubankJenifferRow = planejamento?.find(p => p.item === 'NuBank Jeniffer')
  const nubankJenifferConjRow = planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')

  const nubankMatheusEfetivo = nubankMatheusRow?.pago
    ? (nubankMatheusRow.valor_real ?? nubankMatheusRow.valor_previsto)
    : matheusAtual > 0 ? matheusAtual : matheusPrevisto

  const jenifferNubankPago = !!(nubankJenifferRow?.pago || nubankJenifferConjRow?.pago)
  const nubankJenifferEfetivo = jenifferNubankPago
    ? ((nubankJenifferRow?.pago ? (nubankJenifferRow.valor_real ?? nubankJenifferRow.valor_previsto) : 0) +
       (nubankJenifferConjRow?.pago ? (nubankJenifferConjRow.valor_real ?? nubankJenifferConjRow.valor_previsto) : 0))
    : jenifferAtual > 0 ? jenifferAtual : jenifferPrevisto

  const cartao1PaidRows = (planejamento || []).filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]') && p.pago)
  const cartao1Efetivo = cartao1PaidRows.length > 0
    ? cartao1PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : cartao1TotalAtual > 0 ? cartao1TotalAtual : cartao1PrevTotal

  const cartao2PaidRows = (planejamento || []).filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]') && p.pago)
  const cartao2Efetivo = cartao2PaidRows.length > 0
    ? cartao2PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : cartao2TotalAtual > 0 ? cartao2TotalAtual : cartao2PrevTotal

  const nubankTemDados = totalRealizado > 0 || !!nubankMatheusRow?.pago || !!nubankJenifferRow?.pago || !!nubankJenifferConjRow?.pago
  const cartao1TemDados = cartao1TotalAtual > 0 || cartao1PaidRows.length > 0
  const cartao2TemDados = cartao2TotalAtual > 0 || cartao2PaidRows.length > 0
  const temLancamentosEfetivos = nubankTemDados || cartao1TemDados || cartao2TemDados

  const faturaEfetiva = nubankMatheusEfetivo + nubankJenifferEfetivo + cartao1Efetivo + cartao2Efetivo
  const saldoPrevisto = receitaTotal - totalPlanejado

  const despesasItems = (planejamento || []).filter(p => {
    const item = typeof p.item === 'string' ? p.item : ''
    return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
  })

  const contasFixasAtual = despesasItems
    .filter(p => {
      const item = typeof p.item === 'string' ? p.item : ''
      return !NUBANK_ITEMS.has(item) && !item.startsWith('[CARTAO1]') && !item.startsWith('[CARTAO2]')
    })
    .reduce((acc, p) => acc + (p.pago ? (p.valor_real ?? p.valor_previsto) : p.valor_previsto), 0)

  const todasDespesasPagas = despesasItems.length > 0 && despesasItems.every(p => p.pago)

  const totalGastos = contasFixasAtual + faturaEfetiva
  const sobraLiquida = receitaTotal - totalGastos
  const percentualComprometimento = receitaTotal > 0 ? (totalGastos / receitaTotal) * 100 : 0

  type AssinaturaRow = { nome: string; valor: number; responsavel: string; ativa: boolean }
  type TransacaoRow = { valor: number; responsavel: string | null; descricao: string | null }
  const assinAtivas = (assinaturasData || []).filter((a: AssinaturaRow) => a.ativa)
  const txFaturaList: TransacaoRow[] = transacoesFatura || []
  const calcNaoPaga = (responsavel: string) =>
    assinAtivas
      .filter((a: AssinaturaRow) => a.responsavel === responsavel && !txFaturaList.some((tx: TransacaoRow) => tx.descricao?.toLowerCase().includes(a.nome.toLowerCase())))
      .reduce((sum: number, a: AssinaturaRow) => sum + a.valor, 0)
  const assinNaoPagaMatheus = calcNaoPaga('Matheus')
  const assinNaoPagaJeniffer = calcNaoPaga('Jeniffer')

  const ids = (invData || []).map(i => i.id)
  const aportadoMap: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: aportesData } = await supabase
      .from('investimentos_aportes').select('investimento_id, valor').in('investimento_id', ids)
    for (const a of (aportesData || [])) {
      aportadoMap[a.investimento_id] = (aportadoMap[a.investimento_id] || 0) + a.valor
    }
  }

  return {
    fatura: {
      totalRealizado, matheusAtual, matheusPrevisto, matheusProjecaoParcelas,
      jenifferAtual, jenifferPrevisto, jenifferProjecaoParcelas,
      sobraMatheus: matheusPrevisto - matheusAtual - matheusProjecaoParcelas - assinNaoPagaMatheus,
      sobraJeniffer: jenifferPrevisto - jenifferAtual - jenifferProjecaoParcelas - assinNaoPagaJeniffer,
      cartao1Items: cartao1PlanejamentoItems,
      cartao2Items: cartao2PlanejamentoItems,
      cartao1AtualMatheus: cartao1TotalMatheus, cartao1AtualJeniffer: cartao1TotalJeniffer,
      cartao2AtualMatheus: cartao2TotalMatheus, cartao2AtualJeniffer: cartao2TotalJeniffer,
      cartao1Previsto: cartao1PlanejamentoItems.reduce((s, i) => s + i.previsto, 0),
      cartao2Previsto: cartao2PlanejamentoItems.reduce((s, i) => s + i.previsto, 0),
      cartao1Nome: cartao1PlanejamentoItems[0]?.nome || 'Cartão 1',
      cartao2Nome: cartao2PlanejamentoItems[0]?.nome || 'Cartão 2',
    },
    resumoCaixa: {
      receitaTotal, contasFixas: contasFixasAtual,
      fatura: faturaEfetiva, faturaEhPrevisto: !temLancamentosEfetivos, extras: 0,
      totalGastos, sobraLiquida, saldoPrevisto, percentualComprometimento,
      todasDespesasPagas,
    },
    investimentos: (invData || []).map(i => ({ ...i, aportado: aportadoMap[i.id] || 0 })),
    assinaturasNaopagas: { matheus: assinNaoPagaMatheus, jeniffer: assinNaoPagaJeniffer },
    dataFechamentoNubank,
  }
}

const FATURA_INICIAL: FaturaState = {
  totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0, matheusProjecaoParcelas: 0,
  jenifferAtual: 0, jenifferPrevisto: 0, jenifferProjecaoParcelas: 0,
  sobraMatheus: 0, sobraJeniffer: 0, cartao1Items: [], cartao2Items: [],
  cartao1AtualMatheus: 0, cartao1AtualJeniffer: 0, cartao2AtualMatheus: 0, cartao2AtualJeniffer: 0,
  cartao1Previsto: 0, cartao2Previsto: 0, cartao1Nome: 'Cartão 1', cartao2Nome: 'Cartão 2',
}

const RESUMO_INICIAL: ResumoCaixaState = {
  receitaTotal: 0, contasFixas: 0, fatura: 0, faturaEhPrevisto: false, extras: 0,
  totalGastos: 0, sobraLiquida: 0, saldoPrevisto: 0, percentualComprometimento: 0,
  todasDespesasPagas: false,
}

export default function Dashboard() {
  const { mesAtual, setMesAtual } = useMes()

  // Estado consolidado — um único setState em vez de 5 individuais
  // elimina múltiplos re-renders encadeados no applyData.
  const [dados, setDados] = useState<DashboardData>({
    fatura: FATURA_INICIAL,
    resumoCaixa: RESUMO_INICIAL,
    investimentos: [],
    assinaturasNaopagas: { matheus: 0, jeniffer: 0 },
    dataFechamentoNubank: null,
  })

  const [seletorAberto, setSeletorAberto] = useState(false)
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<{ serie: string; mes: string; valor: number; itens: Record<string, unknown>[] } | null>(null) // itens typed loosely; DrawerDetalhes accepts DrawerItem[] which is compatible
  const [aba, setAba] = useState<'resumo' | 'graficos'>('resumo')
  // Lazy mount: charts only render after the first visit to the Gráficos tab
  const [graficosAbertos, setGraficosAbertos]         = useState(false)
  const [visaoGastosDiarios, setVisaoGastosDiarios]   = useState<'valor' | 'acumulado'>('valor')

  const handleSetAba = useCallback((novaAba: 'resumo' | 'graficos') => {
    setAba(novaAba)
    if (novaAba === 'graficos') setGraficosAbertos(true)
  }, [])

  // Extrai os campos do estado consolidado — sem custo de performance
  const { fatura, resumoCaixa, investimentos, assinaturasNaopagas, dataFechamentoNubank } = dados

  // Aplica dados vindos do cache (stale) ou do fetch fresco — sem mostrar skeleton
  const applyData = useCallback((data: unknown) => {
    setDados(data as DashboardData)
  }, [])

  const fetcher = useCallback(
    () => carregarDados(mesAtual),  
    [mesAtual]
  )

  const { status, isOnline } = useGlobalSync({
    cacheKey: `dashboard:${format(mesAtual, 'yyyy-MM')}`,
    tables: ['transacoes_nubank', 'planejamento', 'investimentos', 'investimentos_aportes'],
    fetcher,
    onData: applyData,
    pollInterval: 45_000,
  })

  // Pre-fetch adjacent months in the background so month-switching never shows a skeleton
  useEffect(() => {
    if (!isOnline) return

    const prefetch = async (mes: Date) => {
      const storageKey = `datasync:dashboard:${format(mes, 'yyyy-MM')}`
      if (localStorage.getItem(storageKey)) return // already cached
      try {
        const data = await carregarDados(mes)
        localStorage.setItem(storageKey, JSON.stringify({ data, ts: Date.now() }))
      } catch { /* background-only; ignore errors */ }
    }

    const prev = subMonths(mesAtual, 1)
    const next = addMonths(mesAtual, 1)

    if ('requestIdleCallback' in window) {
      const id1 = requestIdleCallback(() => { prefetch(prev) }, { timeout: 6000 })
      const id2 = requestIdleCallback(() => { prefetch(next) }, { timeout: 6000 })
      return () => { cancelIdleCallback(id1); cancelIdleCallback(id2) }
    }
    const t1 = setTimeout(() => prefetch(prev), 2500)
    const t2 = setTimeout(() => prefetch(next), 3500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [mesAtual, isOnline])

  // Pre-warm cache for all main pages so navigation to them never shows a skeleton
  usePrefetchPages(mesAtual, isOnline)

  // Mostra skeleton só quando não há dado algum ainda (sem cache, aguardando fetch)
  const carregando = status === 'loading'

  const comprometimentoColor = useMemo(() =>
    resumoCaixa.percentualComprometimento > 90 ? 'text-red-600' :
    resumoCaixa.percentualComprometimento > 70 ? 'text-amber-600' :
    'text-emerald-600',
    [resumoCaixa.percentualComprometimento]
  )

  const matheusSobraWarning = useMemo(() =>
    fatura.sobraMatheus >= 0 && fatura.matheusPrevisto > 0 && (fatura.sobraMatheus / fatura.matheusPrevisto) * 100 <= 10,
    [fatura.sobraMatheus, fatura.matheusPrevisto]
  )
  const jenifferSobraWarning = useMemo(() =>
    fatura.sobraJeniffer >= 0 && fatura.jenifferPrevisto > 0 && (fatura.sobraJeniffer / fatura.jenifferPrevisto) * 100 <= 10,
    [fatura.sobraJeniffer, fatura.jenifferPrevisto]
  )
  const saldoAtualWarning = useMemo(() =>
    resumoCaixa.sobraLiquida >= 0 && resumoCaixa.receitaTotal > 0 && (resumoCaixa.sobraLiquida / resumoCaixa.receitaTotal) * 100 <= 10,
    [resumoCaixa.sobraLiquida, resumoCaixa.receitaTotal]
  )
  const saldoPrevistoWarning = useMemo(() =>
    resumoCaixa.saldoPrevisto >= 0 && resumoCaixa.receitaTotal > 0 && (resumoCaixa.saldoPrevisto / resumoCaixa.receitaTotal) * 100 <= 10,
    [resumoCaixa.saldoPrevisto, resumoCaixa.receitaTotal]
  )

  const comprometimentoBarColor = useMemo(() =>
    resumoCaixa.percentualComprometimento > 90
      ? 'bg-gradient-to-r from-red-500 to-red-600' :
    resumoCaixa.percentualComprometimento > 70
      ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
    'bg-gradient-to-r from-emerald-500 to-green-500',
    [resumoCaixa.percentualComprometimento]
  )

  const heroSaldo = resumoCaixa.sobraLiquida
  const heroColor = heroSaldo < 0 ? 'text-red-600' : saldoAtualWarning ? 'text-amber-600' : 'text-emerald-600'
  const HeroIcon = heroSaldo < 0 ? TrendingDown : heroSaldo === 0 ? Minus : TrendingUp

  // Cartão extras: pré-computado fora do JSX para não recalcular em mudanças de UI state (aba, drawer, etc.)
  const cartaoExtrasData = useMemo(() => {
    if (fatura.cartao1Items.length === 0 && fatura.cartao2Items.length === 0) return null
    const c1M = fatura.cartao1Items.filter(i => i.responsavel === 'Matheus')
    const c1J = fatura.cartao1Items.filter(i => i.responsavel === 'Jeniffer')
    const c2M = fatura.cartao2Items.filter(i => i.responsavel === 'Matheus')
    const c2J = fatura.cartao2Items.filter(i => i.responsavel === 'Jeniffer')
    const c1Total = fatura.cartao1AtualMatheus + fatura.cartao1AtualJeniffer
    const c2Total = fatura.cartao2AtualMatheus + fatura.cartao2AtualJeniffer
    const outrosCards = [
      ...(c1M.length > 0 ? [{ label: c1M.map(i => i.nome).join(' / '), responsavel: 'Matheus', atual: c1Total, previsto: c1M.reduce((s, i) => s + i.previsto, 0) }] : []),
      ...(c1J.length > 0 ? [{ label: c1J.map(i => i.nome).join(' / '), responsavel: 'Jeniffer', atual: c1Total, previsto: c1J.reduce((s, i) => s + i.previsto, 0) }] : []),
      ...(c2M.length > 0 ? [{ label: c2M.map(i => i.nome).join(' / '), responsavel: 'Matheus', atual: c2Total, previsto: c2M.reduce((s, i) => s + i.previsto, 0) }] : []),
      ...(c2J.length > 0 ? [{ label: c2J.map(i => i.nome).join(' / '), responsavel: 'Jeniffer', atual: c2Total, previsto: c2J.reduce((s, i) => s + i.previsto, 0) }] : []),
    ].filter(c => c.atual > 0 || c.previsto > 0)
    const matheusCardsAtual = outrosCards.filter(c => c.responsavel === 'Matheus').reduce((s, c) => s + c.atual, 0)
    const matheusCardsPrevisto = outrosCards.filter(c => c.responsavel === 'Matheus').reduce((s, c) => s + c.previsto, 0)
    const jenifferCardsAtual = outrosCards.filter(c => c.responsavel === 'Jeniffer').reduce((s, c) => s + c.atual, 0)
    const jenifferCardsPrevisto = outrosCards.filter(c => c.responsavel === 'Jeniffer').reduce((s, c) => s + c.previsto, 0)
    const matheusTotalPrevisto = fatura.matheusPrevisto + matheusCardsPrevisto
    const matheusTotalAtual = fatura.matheusAtual + matheusCardsAtual
    const matheusRestante = matheusTotalPrevisto - matheusTotalAtual
    const matheusPct = matheusTotalPrevisto > 0 ? Math.min(100, (matheusTotalAtual / matheusTotalPrevisto) * 100) : 0
    const matheusResumoWarning = matheusRestante >= 0 && matheusTotalPrevisto > 0 && (matheusRestante / matheusTotalPrevisto) * 100 <= 10
    const jenifferTotalPrevisto = fatura.jenifferPrevisto + jenifferCardsPrevisto
    const jenifferTotalAtual = fatura.jenifferAtual + jenifferCardsAtual
    const jenifferRestante = jenifferTotalPrevisto - jenifferTotalAtual
    const jenifferPct = jenifferTotalPrevisto > 0 ? Math.min(100, (jenifferTotalAtual / jenifferTotalPrevisto) * 100) : 0
    const jenifferResumoWarning = jenifferRestante >= 0 && jenifferTotalPrevisto > 0 && (jenifferRestante / jenifferTotalPrevisto) * 100 <= 10
    return { outrosCards, matheusTotalPrevisto, matheusTotalAtual, matheusRestante, matheusPct, matheusResumoWarning, jenifferTotalPrevisto, jenifferTotalAtual, jenifferRestante, jenifferPct, jenifferResumoWarning }
  }, [fatura])

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">

      <PeriodSelectorSheet
        isOpen={seletorAberto}
        currentPeriod={mesAtual}
        onConfirm={setMesAtual}
        onClose={() => setSeletorAberto(false)}
      />

      {/* Header + seletor de mês */}
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        </div>
        <MonthSelector
          value={mesAtual}
          onChange={setMesAtual}
          onOpenSelector={() => setSeletorAberto(true)}
        />
        {/* Segmented control */}
        <div className="mt-3 flex bg-gray-100 rounded-2xl p-1 gap-0.5">
          {(['resumo', 'graficos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleSetAba(t)}
              className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition-colors duration-200 ${
                aba === t
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'resumo' ? 'Resumo' : 'Gráficos'}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">

        {/* ── Resumo tab ── */}
        <div className={`space-y-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start${aba !== 'resumo' ? ' hidden' : ''}`}>

        {/* ── Hero: Saldo do mês ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-5">
          {carregando ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-100 rounded-xl w-1/3" />
              <div className="h-9 bg-gray-100 rounded-xl w-2/3" />
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="h-14 bg-gray-100 rounded-2xl" />
                <div className="h-14 bg-gray-100 rounded-2xl" />
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                    {resumoCaixa.faturaEhPrevisto ? 'Saldo estimado' : 'Saldo atual'}
                    <InfoPopover texto="Quanto sobra da renda após todos os gastos do mês. 'Saldo atual' usa os lançamentos reais da fatura NuBank. 'Saldo estimado' aparece quando a fatura ainda não tem lançamentos — o valor é calculado com base nas parcelas em andamento. Verde = saldo saudável, âmbar = sobra abaixo de 10% da renda, vermelho = saldo negativo. A barra mostra o % da renda comprometido com gastos." />
                  </p>
                  <p className={`text-3xl font-bold num ${heroColor}`}>
                    {fmt(heroSaldo)}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <HeroIcon className={`w-3.5 h-3.5 ${heroColor}`} />
                    <span className="text-xs text-gray-400">
                      {resumoCaixa.percentualComprometimento.toFixed(1)}% da renda comprometido
                    </span>
                  </div>
                </div>
                {resumoCaixa.todasDespesasPagas ? (
                  <span key="historico" className="text-xs border rounded-xl px-2.5 py-1 font-medium bg-amber-50 text-amber-700 border-amber-100 badge-fade-in">
                    Histórico
                  </span>
                ) : resumoCaixa.faturaEhPrevisto ? (
                  <span key="previsao" className="text-xs border rounded-xl px-2.5 py-1 font-medium bg-blue-50 text-blue-700 border-blue-100 badge-fade-in">
                    Previsão
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                  <p className="text-xs text-emerald-600 font-medium mb-0.5">Receita</p>
                  <p className="text-base font-bold text-emerald-700 num">{fmt(resumoCaixa.receitaTotal)}</p>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-2xl p-3">
                  <p className="text-xs text-red-500 font-medium mb-0.5">Gastos</p>
                  <p className="text-base font-bold text-red-600 num">{fmt(resumoCaixa.totalGastos)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 hidden md:block">
                  <p className="text-xs text-gray-500 font-medium mb-0.5">Fixos</p>
                  <p className="text-base font-bold text-gray-700 num">{fmt(resumoCaixa.contasFixas)}</p>
                </div>
                <div className="bg-primary-50 border border-primary-100 rounded-2xl p-3 hidden md:block">
                  <p className="text-xs text-primary-600 font-medium mb-0.5">Extras</p>
                  <p className="text-base font-bold text-primary-700 num">{fmt(resumoCaixa.extras)}</p>
                </div>
              </div>

              {/* Barra de comprometimento */}
              <div className="mt-4">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs text-gray-500">Comprometimento da renda</span>
                  <span className={`text-xs font-bold num ${comprometimentoColor}`}>
                    {resumoCaixa.percentualComprometimento.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-[width] duration-500 ${comprometimentoBarColor}`}
                    style={{ width: `${Math.min(resumoCaixa.percentualComprometimento, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-gray-300">0%</span>
                  <span className="text-[10px] text-amber-400">70%</span>
                  <span className="text-[10px] text-red-400">90%</span>
                  <span className="text-[10px] text-gray-300">100%</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Gestão de Fatura NuBank ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-primary-50 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-primary-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
                Fatura NuBank
                <InfoPopover texto="Gastos no NuBank divididos por pessoa. 'Atual': valor já lançado na fatura do mês. 'Previsto': orçamento planejado. 'Sobra': margem restante dentro do orçamento. 'Parc. prev.': parcelas futuras já comprometidas, exibidas quando a fatura ainda não fechou. 'Outros cartões' e o 'Resumo' consolidam todos os cartões por pessoa." />
              </h2>
            </div>
            {dataFechamentoNubank && !carregando && (() => {
              const d = new Date(dataFechamentoNubank + 'T12:00:00')
              return (
                <div className="shrink-0 bg-primary-50 border border-primary-100 rounded-xl px-2.5 py-1.5 text-right">
                  <p className="text-[10px] font-medium text-primary-400 uppercase tracking-wider leading-none">Fecha</p>
                  <p className="text-xs font-bold text-primary-700 num leading-snug mt-0.5">
                    {format(d, 'dd/MM')}
                  </p>
                  <p className="text-[10px] text-primary-400 capitalize leading-none mt-0.5">
                    {format(d, 'EEEE', { locale: ptBR })}
                  </p>
                </div>
              )
            })()}
          </div>

          {carregando ? (
            <div className="animate-pulse space-y-3">
              <div className="h-8 bg-gray-100 rounded-xl w-2/5" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-28 bg-gray-100 rounded-2xl" />
                <div className="h-28 bg-gray-100 rounded-2xl" />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <p className="text-2xl font-bold text-gray-900 num">{fmt(fatura.totalRealizado)}</p>
                <p className="text-xs text-gray-400 mt-0.5">total atual na fatura NuBank</p>
              </div>

              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">NuBank</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Matheus NuBank */}
                <div className="bg-blue-50 border border-blue-100 border-t-4 border-t-blue-500 p-3 rounded-2xl">
                  <p className="font-bold text-blue-800 text-sm uppercase tracking-wide mb-1.5">Matheus</p>
                  <div className="flex justify-between text-xs gap-1 text-gray-500">
                    <span>Atual</span>
                    <span className="font-medium text-gray-800 num">{fmt(fatura.matheusAtual)}</span>
                  </div>
                  <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-500">
                    <span>Previsto</span>
                    <span className="font-medium text-gray-800 num">{fmt(fatura.matheusPrevisto)}</span>
                  </div>
                  {assinaturasNaopagas.matheus > 0 && (
                    <div className="flex justify-between text-xs gap-1 mt-0.5 text-indigo-600">
                      <span>Assinaturas</span>
                      <span className="font-medium num">{fmt(assinaturasNaopagas.matheus)}</span>
                    </div>
                  )}
                  {fatura.matheusProjecaoParcelas > 0 && (
                    <div className="flex justify-between items-center gap-1 mt-0.5 text-[10px]">
                      <span className="text-gray-500 whitespace-nowrap shrink-0">Parc. prev.</span>
                      <span className="font-medium text-orange-700 num whitespace-nowrap">− {fmt(fatura.matheusProjecaoParcelas)}</span>
                    </div>
                  )}
                  <div className="mt-2 h-2 bg-blue-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-[width] duration-400" style={{ width: `${fatura.matheusPrevisto > 0 ? Math.min(100, (fatura.matheusAtual / fatura.matheusPrevisto) * 100) : 0}%` }} />
                  </div>
                  <p className="text-right text-[10px] text-blue-500 mt-0.5 num">{fatura.matheusPrevisto > 0 ? Math.min(100, (fatura.matheusAtual / fatura.matheusPrevisto) * 100).toFixed(0) : 0}%</p>
                  <div className={`flex justify-between text-xs font-bold mt-1.5 gap-1 ${fatura.sobraMatheus < 0 ? 'text-red-600' : matheusSobraWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                    <span className="flex items-center gap-0.5 whitespace-nowrap">
                      {fatura.sobraMatheus < 0 ? '⚠ Excesso' : matheusSobraWarning ? <><AlertTriangle className="w-3 h-3 inline-block" /> Atenção!</> : '✓ Restante'}
                    </span>
                    <span className="num shrink-0">{fmt(Math.abs(fatura.sobraMatheus))}</span>
                  </div>
                </div>

                {/* Jeniffer NuBank */}
                <div className="bg-pink-50 border border-pink-100 border-t-4 border-t-pink-500 p-3 rounded-2xl">
                  <p className="font-bold text-pink-800 text-sm uppercase tracking-wide mb-1.5">Jeniffer</p>
                  <div className="flex justify-between text-xs gap-1 text-gray-500">
                    <span>Atual</span>
                    <span className="font-medium text-gray-800 num">{fmt(fatura.jenifferAtual)}</span>
                  </div>
                  <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-500">
                    <span>Previsto</span>
                    <span className="font-medium text-gray-800 num">{fmt(fatura.jenifferPrevisto)}</span>
                  </div>
                  {assinaturasNaopagas.jeniffer > 0 && (
                    <div className="flex justify-between text-xs gap-1 mt-0.5 text-indigo-600">
                      <span>Assinaturas</span>
                      <span className="font-medium num">{fmt(assinaturasNaopagas.jeniffer)}</span>
                    </div>
                  )}
                  {fatura.jenifferProjecaoParcelas > 0 && (
                    <div className="flex justify-between items-center gap-1 mt-0.5 text-[10px]">
                      <span className="text-gray-500 whitespace-nowrap shrink-0">Parc. prev.</span>
                      <span className="font-medium text-orange-700 num whitespace-nowrap">− {fmt(fatura.jenifferProjecaoParcelas)}</span>
                    </div>
                  )}
                  <div className="mt-2 h-2 bg-pink-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-500 rounded-full transition-[width] duration-400" style={{ width: `${fatura.jenifferPrevisto > 0 ? Math.min(100, (fatura.jenifferAtual / fatura.jenifferPrevisto) * 100) : 0}%` }} />
                  </div>
                  <p className="text-right text-[10px] text-pink-500 mt-0.5 num">{fatura.jenifferPrevisto > 0 ? Math.min(100, (fatura.jenifferAtual / fatura.jenifferPrevisto) * 100).toFixed(0) : 0}%</p>
                  <div className={`flex justify-between text-xs font-bold mt-1.5 gap-1 ${fatura.sobraJeniffer < 0 ? 'text-red-600' : jenifferSobraWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                    <span className="flex items-center gap-0.5 whitespace-nowrap">
                      {fatura.sobraJeniffer < 0 ? '⚠ Excesso' : jenifferSobraWarning ? <><AlertTriangle className="w-3 h-3 inline-block" /> Atenção!</> : '✓ Restante'}
                    </span>
                    <span className="num shrink-0">{fmt(Math.abs(fatura.sobraJeniffer))}</span>
                  </div>
                </div>
              </div>

              {cartaoExtrasData && (() => {
                const { outrosCards, matheusTotalPrevisto, matheusTotalAtual, matheusRestante, matheusPct, matheusResumoWarning, jenifferTotalPrevisto, jenifferTotalAtual, jenifferRestante, jenifferPct, jenifferResumoWarning } = cartaoExtrasData
                return (
                  <div className="mt-4 opacity-70">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Outros cartões</p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                      {outrosCards.map((card, i) => {
                        const sobra = Math.round((card.previsto - card.atual) * 100) / 100
                        const pct = card.previsto > 0 ? Math.min(100, (card.atual / card.previsto) * 100) : 0
                        const pctRestante = card.previsto > 0 ? (sobra / card.previsto) * 100 : 100
                        const isWarning = sobra >= 0 && pctRestante <= 10
                        const isMatheus = card.responsavel === 'Matheus'
                        return (
                          <div key={i} className={`p-2 rounded-2xl border border-t-2 ${
                            isMatheus ? 'bg-blue-50 border-blue-100 border-t-blue-400' : 'bg-pink-50 border-pink-100 border-t-pink-400'
                          }`}>
                            <p className={`font-semibold text-xs mb-1 ${isMatheus ? 'text-blue-800' : 'text-pink-800'}`}>{card.label}</p>
                            <div className="flex justify-between text-xs gap-1 text-gray-500">
                              <span>Atual</span>
                              <span className="font-medium text-gray-800 num">{fmt(card.atual)}</span>
                            </div>
                            <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-500">
                              <span>Previsto</span>
                              <span className="font-medium text-gray-800 num">{fmt(card.previsto)}</span>
                            </div>
                            <div className={`mt-1.5 h-2 rounded-full overflow-hidden ${isMatheus ? 'bg-blue-100' : 'bg-pink-100'}`}>
                              <div className={`h-full rounded-full transition-[width] duration-400 ${isMatheus ? 'bg-blue-400' : 'bg-pink-400'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className={`flex items-center justify-between text-xs font-bold mt-1 gap-1 ${
                              sobra < 0 ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-emerald-600'
                            }`}>
                              <span className="flex items-center gap-0.5 whitespace-nowrap">
                                {sobra < 0 ? '⚠ Excesso' : isWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção!</> : '✓ Restante'}
                              </span>
                              <span className="num shrink-0">{fmt(Math.abs(sobra))}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-3 mb-2">Resumo por pessoa</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-blue-50 border border-blue-100 border-t-4 border-t-blue-500 p-2 rounded-2xl">
                        <p className="font-bold text-xs text-blue-700 uppercase tracking-wide mb-1.5">Matheus</p>
                        <div className="flex justify-between text-xs gap-1 text-gray-500"><span>Atual</span><span className="font-medium text-gray-800 num">{fmt(matheusTotalAtual)}</span></div>
                        <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-500"><span>Previsto</span><span className="font-medium text-gray-800 num">{fmt(matheusTotalPrevisto)}</span></div>
                        <div className="mt-1.5 h-2 bg-blue-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-[width] duration-400" style={{ width: `${matheusPct}%` }} />
                        </div>
                        <div className={`flex justify-between text-xs font-bold mt-1 gap-1 ${matheusRestante < 0 ? 'text-red-600' : matheusResumoWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                          <span className="flex items-center gap-0.5 whitespace-nowrap">{matheusRestante < 0 ? '⚠ Excesso' : matheusResumoWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção!</> : '✓ Restante'}</span>
                          <span className="num shrink-0">{fmt(Math.abs(matheusRestante))}</span>
                        </div>
                      </div>
                      <div className="bg-pink-50 border border-pink-100 border-t-4 border-t-pink-500 p-2 rounded-2xl">
                        <p className="font-bold text-xs text-pink-700 uppercase tracking-wide mb-1.5">Jeniffer</p>
                        <div className="flex justify-between text-xs gap-1 text-gray-500"><span>Atual</span><span className="font-medium text-gray-800 num">{fmt(jenifferTotalAtual)}</span></div>
                        <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-500"><span>Previsto</span><span className="font-medium text-gray-800 num">{fmt(jenifferTotalPrevisto)}</span></div>
                        <div className="mt-1.5 h-2 bg-pink-100 rounded-full overflow-hidden">
                          <div className="h-full bg-pink-500 rounded-full transition-[width] duration-400" style={{ width: `${jenifferPct}%` }} />
                        </div>
                        <div className={`flex justify-between text-xs font-bold mt-1 gap-1 ${jenifferRestante < 0 ? 'text-red-600' : jenifferResumoWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                          <span className="flex items-center gap-0.5 whitespace-nowrap">{jenifferRestante < 0 ? '⚠ Excesso' : jenifferResumoWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção!</> : '✓ Restante'}</span>
                          <span className="num shrink-0">{fmt(Math.abs(jenifferRestante))}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </>
          )}
        </div>

        {/* ── Resumo de Caixa ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
              Resumo de Caixa
              <InfoPopover texto="Visão geral do mês. 'Saldo Previsto': resultado usando apenas os valores planejados no orçamento. 'Saldo Atual': resultado real com a fatura NuBank do mês (ou estimativa por parcelas quando ainda não fechou). O comprometimento mostra qual % da renda já está comprometido com gastos." />
            </h2>
          </div>
          {carregando ? (
            <div className="animate-pulse space-y-2.5">
              <div className="h-5 bg-gray-100 rounded-xl w-full" />
              <div className="h-5 bg-gray-100 rounded-xl w-full" />
              <div className="h-5 bg-gray-100 rounded-xl w-full" />
              <div className="h-3 bg-gray-100 rounded-full w-full mt-2" />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Receita prevista</span>
                <span className="text-emerald-700 font-semibold num">{fmt(resumoCaixa.receitaTotal)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Despesas planejadas</span>
                <span className="text-gray-700 font-medium num">− {fmt(resumoCaixa.contasFixas)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500 flex items-center gap-1.5">
                  Faturas
                  {resumoCaixa.faturaEhPrevisto && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">estimado</span>
                  )}
                </span>
                <span className="text-gray-700 font-medium num">− {fmt(resumoCaixa.fatura)}</span>
              </div>
              <div className="border-t border-gray-100 pt-3 grid grid-cols-2 gap-2">
                <div className="flex flex-col items-center py-2.5 px-3 rounded-2xl bg-gray-50 border border-gray-100">
                  <span className="text-xs text-gray-500 mb-1">Saldo Previsto</span>
                  <span className={`text-base font-bold num ${resumoCaixa.saldoPrevisto < 0 ? 'text-red-600' : saldoPrevistoWarning ? 'text-amber-600' : 'text-primary-600'}`}>
                    {fmt(resumoCaixa.saldoPrevisto)}
                  </span>
                  {saldoPrevistoWarning && resumoCaixa.saldoPrevisto >= 0
                    ? <span className="text-[10px] text-amber-600 font-semibold mt-0.5 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Atenção!</span>
                    : <span className="text-[10px] text-gray-400 mt-0.5">só previsões</span>
                  }
                </div>
                <div className="flex flex-col items-center py-2.5 px-3 rounded-2xl bg-primary-50 border border-primary-100">
                  <span className="text-xs text-primary-600 mb-1">Saldo Atual</span>
                  <span className={`text-base font-bold num ${resumoCaixa.sobraLiquida < 0 ? 'text-red-600' : saldoAtualWarning ? 'text-amber-600' : 'text-primary-700'}`}>
                    {fmt(resumoCaixa.sobraLiquida)}
                  </span>
                  {saldoAtualWarning && resumoCaixa.sobraLiquida >= 0
                    ? <span className="text-[10px] text-amber-600 font-semibold mt-0.5 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Atenção!</span>
                    : <span className="text-[10px] text-primary-400 mt-0.5">{resumoCaixa.faturaEhPrevisto ? 'fatura estimada' : 'fatura real'}</span>
                  }
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Insights por IA — somente no mês atual ── */}
        {isSameMonth(mesAtual, new Date()) && <InsightsCard />}

        {/* ── Investimentos ── */}
        {(carregando || investimentos.length > 0) && (
          <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
                  <PiggyBank className="w-4 h-4 text-violet-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
                  Investimentos
                  <InfoPopover texto="Progresso dos aportes do mês em cada investimento. A meta é calculada como um percentual do saldo atual (receita − gastos reais). Verde = meta atingida. A linha 'prev.' indica a meta com base no saldo planejado, quando for diferente do saldo real." />
                </h2>
              </div>
              <a href="/investimentos" className="text-xs text-violet-600 hover:text-violet-700 transition-colors font-medium">
                Ver tudo
              </a>
            </div>
            {carregando ? (
              <div className="animate-pulse space-y-3">
                <div className="h-5 bg-gray-100 rounded-xl w-3/4" />
                <div className="h-5 bg-gray-100 rounded-xl w-1/2" />
              </div>
            ) : (
              <div className="space-y-3">
                {investimentos.map((inv) => {
                  const meta = resumoCaixa.sobraLiquida > 0 ? resumoCaixa.sobraLiquida * inv.percentual / 100 : 0
                  const metaPrevista = resumoCaixa.saldoPrevisto > 0 ? resumoCaixa.saldoPrevisto * inv.percentual / 100 : 0
                  const progresso = meta > 0 ? Math.min((inv.aportado / meta) * 100, 100) : 0
                  const concluido = meta > 0 && inv.aportado >= meta
                  return (
                    <div key={inv.id}>
                      <div className="flex justify-between items-center text-sm mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${concluido ? 'bg-emerald-500' : 'bg-violet-400'}`} />
                          <span className="text-gray-700 text-sm">{inv.descricao}</span>
                        </div>
                        <div className="text-right">
                          <div>
                            <span className={`font-semibold num ${concluido ? 'text-emerald-600' : 'text-violet-700'}`}>
                              {fmt(inv.aportado)}
                            </span>
                            <span className="text-gray-400 text-xs ml-1 num">/ {fmt(meta)}</span>
                          </div>
                          {metaPrevista !== meta && metaPrevista > 0 && (
                            <div className="text-xs text-violet-400 num">prev. {fmt(metaPrevista)}</div>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-[width] duration-400 ${concluido ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-violet-400 to-violet-600'}`}
                          style={{ width: `${progresso}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {investimentos.length > 0 && (
                  <div className="border-t border-gray-100 pt-2.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 font-medium">Total aportado</span>
                      <span className="font-bold text-violet-700 num">
                        {fmt(investimentos.reduce((a, i) => a + i.aportado, 0))}
                      </span>
                    </div>
                    {resumoCaixa.saldoPrevisto !== resumoCaixa.sobraLiquida && (
                      <div className="flex justify-between items-center text-xs mt-1">
                        <span className="text-violet-400">Meta total prevista</span>
                        <span className="text-violet-500 font-medium num">
                          {fmt(investimentos.reduce((a, i) => a + (resumoCaixa.saldoPrevisto > 0 ? resumoCaixa.saldoPrevisto * i.percentual / 100 : 0), 0))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        </div>{/* /resumo */}

        {graficosAbertos && (
          <div className={`space-y-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start${aba !== 'graficos' ? ' hidden' : ''}`}>

        {/* ── Gastos Diários ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
              <Activity className="w-4 h-4 text-violet-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
              Gastos Diários
              <InfoPopover texto="Evolução dos gastos ao longo dos dias do mês selecionado. Considera todas as compras com data de compra registrada no período. Use os filtros para visualizar por pessoa ou por cartão." />
            </h2>
            <div className="ml-auto inline-flex items-center bg-gray-100 rounded-full p-[3px] gap-[2px]">
              <button
                onClick={() => setVisaoGastosDiarios('valor')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-200 ${
                  visaoGastosDiarios === 'valor'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                Valor
              </button>
              <button
                onClick={() => setVisaoGastosDiarios('acumulado')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-200 ${
                  visaoGastosDiarios === 'acumulado'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <BarChart2 className="w-3 h-3" />
                Acumulado
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-10">
            {visaoGastosDiarios === 'acumulado' ? 'Real vs Esperado · Toque para detalhes' : 'Dia a dia · Toque para detalhes'}
          </p>
          <GraficoGastosDiarios
            mesAtual={mesAtual}
            cartao1Nome={fatura.cartao1Nome}
            cartao2Nome={fatura.cartao2Nome}
            visao={visaoGastosDiarios}
            onVisaoChange={setVisaoGastosDiarios}
          />
        </div>

        {/* ── Categorias de Despesas ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
              Categorias de Despesas
              <InfoPopover texto="Distribuição dos gastos por categoria no mês selecionado. Quando há faturas ou compras importadas, o gráfico usa os valores reais — nunca duplica previsto + real. Toque em uma coluna para ver o detalhamento." />
            </h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-10">Maior → menor · Toque para detalhes</p>
          <GraficoCategoriasDespesas mesAtual={mesAtual} />
        </div>

        {/* ── Projeção de Parcelamentos ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
              Projeção de Parcelamentos
              <InfoPopover texto="Total de parcelas previstas para vencer nos próximos 6 meses, separado por pessoa e extras. Calculado a partir das compras parceladas já registradas no NuBank. Toque em um ponto do gráfico para ver os detalhes de cada mês." />
            </h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-10">Próximos 6 meses · Toque em um ponto para detalhes</p>
          <GraficoProjecao
            mesInicio={mesAtual}
            onPontoClicado={(serie, mes, valor, itens) => {
              setDetalhesPonto({ serie, mes, valor, itens })
              setDrawerAberto(true)
            }}
          />
        </div>

        {/* ── Categorias da Fatura ── */}
        <div className="lg:col-span-1">
          <CategoryTreemap mesAtual={mesAtual} />
        </div>

        {/* ── Evolução Financeira Mensal ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <LineChart className="w-4 h-4 text-emerald-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
              Evolução Financeira
              <InfoPopover texto="Visão mensal das receitas, despesas e investimentos dos últimos 6 meses. Receitas e despesas são baseadas no planejamento do mês; investimentos refletem aportes realizados." />
            </h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-10">Últimos 6 meses · Passe o cursor para detalhes</p>
          <GraficoEvolucaoMensal mesAtual={mesAtual} />
        </div>

        {/* ── Evolução de Investimentos ── */}
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
              <PiggyBank className="w-4 h-4 text-violet-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
              Evolução de Investimentos
              <InfoPopover texto="Evolução dos aportes mês a mês nos últimos 6 meses. A linha sólida mostra o valor efetivamente investido; a linha tracejada indica a meta calculada (percentual do saldo). Meses futuros exibem apenas a projeção da meta." />
            </h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-10">Últimos 6 meses · Realizado vs. Meta</p>
          <GraficoEvolucaoInvestimentos mesAtual={mesAtual} />
        </div>

          </div>
        )}{/* /graficos */}

      </div>

      <DrawerDetalhes
        aberto={drawerAberto}
        onClose={() => setDrawerAberto(false)}
        dados={detalhesPonto}
        cartaoLabels={{ nubank: 'NuBank', cartao1: fatura.cartao1Nome, cartao2: fatura.cartao2Nome }}
      />
    </div>
  )
}
