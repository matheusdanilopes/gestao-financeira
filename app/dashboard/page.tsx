'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
  loading: () => <div className="h-56 md:h-64 lg:h-72 skeleton rounded-2xl" />,
})

const GraficoEvolucaoMensal = dynamic(() => import('@/components/GraficoEvolucaoMensal'), {
  ssr: false,
  loading: () => <div className="h-56 md:h-64 lg:h-72 skeleton rounded-2xl" />,
})

const GraficoEvolucaoInvestimentos = dynamic(
  () => import('@/components/GraficoEvolucaoInvestimentos'),
  {
    ssr: false,
    loading: () => <div className="h-56 skeleton rounded-2xl" />,
  }
)

const GraficoGastosDiarios = dynamic(() => import('@/components/GraficoGastosDiarios'), {
  ssr: false,
  loading: () => <div className="h-48 skeleton rounded-2xl" />,
})

const CategoryTreemap = dynamic(() => import('@/components/CategoryTreemap'), { ssr: false })

const GraficoCategoriasDespesas = dynamic(
  () => import('@/components/GraficoCategoriasDespesas'),
  {
    ssr: false,
    loading: () => <div className="h-64 skeleton rounded-2xl" />,
  }
)
import { InfoPopover } from '@/components/InfoPopover'

const DrawerDetalhes = dynamic(() => import('@/components/DrawerDetalhes'), { ssr: false })
const PeriodSelectorSheet = dynamic(() => import('@/components/PeriodSelectorSheet'), { ssr: false })
const InsightsCard = dynamic(() => import('@/components/InsightsCard'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-gray-100 rounded-xl shrink-0" />
        <div className="h-4 bg-gray-100 rounded-full w-32" />
        <div className="ml-auto h-5 bg-gray-100 rounded-full w-14" />
      </div>
      <div className="space-y-3">
        <div className="h-[88px] bg-gray-100 rounded-2xl" />
        <div className="h-[88px] bg-gray-100 rounded-2xl" />
      </div>
    </div>
  ),
})
const LimitesCategorias = dynamic(() => import('@/components/LimitesCategorias'), { ssr: false })

const GraficoAnual = dynamic(() => import('@/components/GraficoAnual'), {
  ssr: false,
  loading: () => <div className="h-64 skeleton rounded-2xl" />,
})
import { useGlobalSync } from '@/lib/useGlobalSync'
import { usePrefetchPages } from '@/lib/usePrefetchPages'
import { formatBRL as fmt } from '@/lib/logger'

function isNuBankItem(item: string): boolean {
  const lower = item.toLowerCase()
  return lower === 'nubank matheus' || lower === 'nubank jeniffer' ||
         lower === 'nubank jeniffer conjunto' || lower === 'nubank conjunto'
}

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
  conjuntoAtual: number
  conjuntoPrevisto: number
  conjuntoProjecaoParcelas: number
  conjuntoItemExiste: boolean
  sobraMatheus: number
  sobraJeniffer: number
  sobraConjunto: number
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
  assinaturasDivergentes: {
    matheus: { nome: string; valorEsperado: number; valorCobrado: number; diff: number }[]
    jeniffer: { nome: string; valorEsperado: number; valorCobrado: number; diff: number }[]
  }
  dataFechamentoNubank: string | null
}


async function carregarDados(mes: Date): Promise<DashboardData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [
    { data: todasTransacoesFatura },
    { data: planejamento },
    { data: invData },
    { data: nubankConfigs },
    { data: faturaRegistradaData },
    { data: assinaturasData },
    { data: maxFaturaRowData },
  ] = await Promise.all([
    // Busca todas as transações do período em uma única query e separa por cartão no cliente
    supabase.from('transacoes_nubank').select('valor, responsavel, descricao, cartao').eq('projeto_fatura', mesRefFatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO'),
    supabase.from('planejamento').select('item, responsavel, valor_previsto, pago, valor_real').eq('mes_referencia', mesRef),
    // Busca aportes embutidos para eliminar a query sequencial posterior
    supabase.from('investimentos').select('id, descricao, percentual, investimentos_aportes(valor)').eq('mes_referencia', mesRef).order('created_at', { ascending: true }),
    supabase.from('configuracoes').select('chave, valor').in('chave', ['dia_vencimento', 'ajuste_fechamento']),
    supabase.from('faturas').select('data_fechamento').eq('cartao', 'nubank').eq('mes_referencia', mesRefFatura).limit(1),
    supabase.from('assinaturas').select('nome, valor, responsavel, ativa').eq('cartao', 'nubank'),
    supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'nubank')
      .lte('projeto_fatura', mesRefFatura).order('projeto_fatura', { ascending: false }).limit(1),
  ])

  // Separa transações por cartão (filtro feito no cliente para evitar 3 queries paralelas)
  const transacoesFatura = todasTransacoesFatura?.filter(t => t.cartao === 'nubank') ?? []
  const transacoesC1 = todasTransacoesFatura?.filter(t => t.cartao === 'cartao1') ?? []
  const transacoesC2 = todasTransacoesFatura?.filter(t => t.cartao === 'cartao2') ?? []

  // Monta mapa de aportes a partir dos dados embutidos (sem query sequencial adicional)
  const aportadoMap: Record<string, number> = {}
  for (const inv of (invData || [])) {
    const aportes = (inv as { investimentos_aportes?: { valor: number }[] }).investimentos_aportes ?? []
    aportadoMap[inv.id] = aportes.reduce((s, a) => s + a.valor, 0)
  }

  const diaVencNubank = parseInt(nubankConfigs?.find((c: { chave: string; valor: string }) => c.chave === 'dia_vencimento')?.valor || '10')
  const ajusteNubank  = parseInt(nubankConfigs?.find((c: { chave: string; valor: string }) => c.chave === 'ajuste_fechamento')?.valor || '0')
  const mesRefFaturaDate = startOfMonth(addMonths(mes, 1))
  const dataFechamentoNubank = faturaRegistradaData?.[0]?.data_fechamento
    || format(calcularDataFechamentoDaFatura(mesRefFaturaDate, diaVencNubank, ajusteNubank), 'yyyy-MM-dd')

  const totalRealizado = transacoesFatura?.reduce((acc, t) => acc + t.valor, 0) || 0
  const matheusAtual = transacoesFatura?.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0) || 0
  const jenifferAtual = transacoesFatura?.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0) || 0
  const conjuntoAtual = transacoesFatura?.filter(t => t.responsavel === 'Conjunto').reduce((acc, t) => acc + t.valor, 0) || 0

  const matheusPrevisto = planejamento?.find(p => p.item.toLowerCase() === 'nubank matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (planejamento?.find(p => p.item.toLowerCase() === 'nubank jeniffer')?.valor_previsto || 0) +
    (planejamento?.find(p => p.item.toLowerCase() === 'nubank jeniffer conjunto')?.valor_previsto || 0)
  const conjuntoPrevisto = planejamento?.find(p => p.item.toLowerCase() === 'nubank conjunto')?.valor_previsto || 0

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

  const nuBankPrevisto = matheusPrevisto + jenifferPrevisto + conjuntoPrevisto
  const faturaEhPrevisto = totalRealizado === 0

  let matheusProjecaoParcelas = 0
  let jenifferProjecaoParcelas = 0
  let conjuntoProjecaoParcelas = 0
  if (faturaEhPrevisto) {
    const mesProjecao = startOfMonth(addMonths(mes, 1))

    if (maxFaturaRowData?.[0]?.projeto_fatura) {
      const { data: transacoesBase } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura, descricao, valor, responsavel, parcela_atual, total_parcelas')
        .eq('cartao', 'nubank').eq('projeto_fatura', maxFaturaRowData[0].projeto_fatura)
        .neq('status', 'ESTORNO').neq('status', 'ESTORNADO')

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
          if (responsavel === 'Conjunto') conjuntoProjecaoParcelas += valor
        }
      }
    }
  }

  const cartao1TotalAtual = cartao1TotalMatheus + cartao1TotalJeniffer
  const cartao2TotalAtual = cartao2TotalMatheus + cartao2TotalJeniffer
  const cartao1PrevTotal = cartao1PlanejamentoItems.reduce((s, i) => s + i.previsto, 0)
  const cartao2PrevTotal = cartao2PlanejamentoItems.reduce((s, i) => s + i.previsto, 0)

  const nubankMatheusRow = planejamento?.find(p => p.item.toLowerCase() === 'nubank matheus')
  const nubankJenifferRow = planejamento?.find(p => p.item.toLowerCase() === 'nubank jeniffer')
  const nubankJenifferConjRow = planejamento?.find(p => p.item.toLowerCase() === 'nubank jeniffer conjunto')
  const nubankConjuntoRow = planejamento?.find(p => p.item.toLowerCase() === 'nubank conjunto')

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

  const conjuntoEfetivo = nubankConjuntoRow?.pago
    ? (nubankConjuntoRow.valor_real ?? conjuntoPrevisto)
    : conjuntoAtual > 0 ? conjuntoAtual : conjuntoPrevisto
  const faturaEfetiva = nubankMatheusEfetivo + nubankJenifferEfetivo + conjuntoEfetivo + cartao1Efetivo + cartao2Efetivo
  const saldoPrevisto = receitaTotal - totalPlanejado

  const despesasItems = (planejamento || []).filter(p => {
    const item = typeof p.item === 'string' ? p.item : ''
    return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
  })

  const contasFixasAtual = despesasItems
    .filter(p => {
      const item = typeof p.item === 'string' ? p.item : ''
      return !isNuBankItem(item) && !item.startsWith('[CARTAO1]') && !item.startsWith('[CARTAO2]')
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

  type AssinDivergente = { nome: string; valorEsperado: number; valorCobrado: number; diff: number }
  const calcDivergente = (responsavel: string): AssinDivergente[] =>
    assinAtivas
      .filter((a: AssinaturaRow) => a.responsavel === responsavel)
      .flatMap((a: AssinaturaRow) => {
        const nome = a.nome.toLowerCase()
        const matches = txFaturaList.filter((tx: TransacaoRow) =>
          tx.descricao?.toLowerCase().includes(nome)
        )
        if (matches.length === 0) return []
        if (matches.some((tx: TransacaoRow) => Math.abs(tx.valor - a.valor) <= 0.05)) return []
        const best = matches.reduce((prev: TransacaoRow, cur: TransacaoRow) =>
          Math.abs(cur.valor - a.valor) < Math.abs(prev.valor - a.valor) ? cur : prev
        )
        return [{ nome: a.nome, valorEsperado: a.valor, valorCobrado: best.valor, diff: best.valor - a.valor }]
      })
  const divergentesMatheus  = calcDivergente('Matheus')
  const divergentesJeniffer = calcDivergente('Jeniffer')

  return {
    fatura: {
      totalRealizado, matheusAtual, matheusPrevisto, matheusProjecaoParcelas,
      jenifferAtual, jenifferPrevisto, jenifferProjecaoParcelas,
      conjuntoAtual, conjuntoPrevisto, conjuntoProjecaoParcelas,
      conjuntoItemExiste: !!nubankConjuntoRow,
      sobraMatheus: matheusPrevisto - matheusAtual - matheusProjecaoParcelas - assinNaoPagaMatheus,
      sobraJeniffer: jenifferPrevisto - jenifferAtual - jenifferProjecaoParcelas - assinNaoPagaJeniffer,
      sobraConjunto: conjuntoPrevisto - conjuntoAtual - conjuntoProjecaoParcelas,
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
    assinaturasDivergentes: { matheus: divergentesMatheus, jeniffer: divergentesJeniffer },
    dataFechamentoNubank,
  }
}

const FATURA_INICIAL: FaturaState = {
  totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0, matheusProjecaoParcelas: 0,
  jenifferAtual: 0, jenifferPrevisto: 0, jenifferProjecaoParcelas: 0,
  conjuntoAtual: 0, conjuntoPrevisto: 0, conjuntoProjecaoParcelas: 0,
  conjuntoItemExiste: false,
  sobraMatheus: 0, sobraJeniffer: 0, sobraConjunto: 0, cartao1Items: [], cartao2Items: [],
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

  const [dados, setDados] = useState<DashboardData>({
    fatura: FATURA_INICIAL,
    resumoCaixa: RESUMO_INICIAL,
    investimentos: [],
    assinaturasNaopagas: { matheus: 0, jeniffer: 0 },
    assinaturasDivergentes: { matheus: [], jeniffer: [] },
    dataFechamentoNubank: null,
  })

  const [seletorAberto, setSeletorAberto] = useState(false)
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<{ serie: string; mes: string; valor: number; itens: Record<string, unknown>[] } | null>(null)
  const [aba, setAba] = useState<'resumo' | 'graficos'>('resumo')
  const [graficosAbertos, setGraficosAbertos] = useState(false)
  const [visaoGastosDiarios, setVisaoGastosDiarios] = useState<'valor' | 'burndown'>('valor')

  const handleSetAba = useCallback((novaAba: 'resumo' | 'graficos') => {
    setAba(novaAba)
    if (novaAba === 'graficos') setGraficosAbertos(true)
  }, [])

  const { fatura, resumoCaixa, investimentos, assinaturasNaopagas, assinaturasDivergentes, dataFechamentoNubank } = dados

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

  useEffect(() => {
    if (!isOnline) return

    const prefetch = async (mes: Date) => {
      const storageKey = `datasync:dashboard:${format(mes, 'yyyy-MM')}`
      if (localStorage.getItem(storageKey)) return
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

  usePrefetchPages(mesAtual, isOnline)

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

  const totalInvestido = useMemo(
    () => investimentos.reduce((a, i) => a + i.aportado, 0),
    [investimentos]
  )

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

  const hora = new Date().getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">

      <PeriodSelectorSheet
        isOpen={seletorAberto}
        currentPeriod={mesAtual}
        onConfirm={setMesAtual}
        onClose={() => setSeletorAberto(false)}
      />

      {/* ── Compact sticky header ── */}
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <div className="flex items-center mb-2 pr-20">
          <div>
            <p className="text-[11px] font-medium text-gray-400 leading-none">{saudacao}</p>
            <h1 className="text-lg font-bold text-gray-900 leading-tight mt-0.5">Dashboard</h1>
          </div>
        </div>
        <MonthSelector
          value={mesAtual}
          onChange={setMesAtual}
          onOpenSelector={() => setSeletorAberto(true)}
        />
        <div className="mt-2.5 flex bg-gray-100 rounded-2xl p-1 gap-0.5">
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
        <div key={`resumo-${aba}`} className={aba === 'resumo' ? 'tab-content-enter space-y-4' : 'hidden'}>

          {/* ── 1. Hero Card — visão financeira consolidada ── */}
          <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-5">
            {carregando ? (
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-100 rounded-xl w-1/3" />
                <div className="h-10 bg-gray-100 rounded-xl w-2/3" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-16 bg-gray-100 rounded-2xl" />
                  <div className="h-16 bg-gray-100 rounded-2xl" />
                </div>
                <div className="h-2 bg-gray-100 rounded-full w-full" />
              </div>
            ) : (
              <div className="content-enter">
                {/* Label + badge */}
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                    {resumoCaixa.faturaEhPrevisto ? 'Saldo estimado' : 'Saldo atual'}
                    <InfoPopover texto="Quanto sobra da renda após todos os gastos do mês. 'Saldo atual' usa os lançamentos reais da fatura NuBank. 'Saldo estimado' aparece quando a fatura ainda não tem lançamentos — o valor é calculado com base nas parcelas em andamento. Verde = saldo saudável, âmbar = sobra abaixo de 10% da renda, vermelho = saldo negativo. A barra mostra o % da renda comprometido com gastos." />
                  </p>
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

                {/* Main balance value */}
                <div className="mb-4">
                  <p key={heroSaldo} className={`text-4xl lg:text-5xl font-bold num value-tight value-update ${heroColor}`}>
                    {fmt(heroSaldo)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5">
                    <div className="flex items-center gap-1">
                      <HeroIcon className={`w-3.5 h-3.5 ${comprometimentoColor}`} />
                      <span className="text-xs text-gray-400">
                        {resumoCaixa.percentualComprometimento.toFixed(1)}% comprometido
                      </span>
                    </div>
                    {resumoCaixa.saldoPrevisto !== heroSaldo && resumoCaixa.receitaTotal > 0 && (
                      <span className="text-xs text-gray-400">
                        · Previsto:{' '}
                        <span className={`font-semibold num ${
                          resumoCaixa.saldoPrevisto < 0 ? 'text-red-500' :
                          saldoPrevistoWarning ? 'text-amber-500' : 'text-gray-600'
                        }`}>
                          {fmt(resumoCaixa.saldoPrevisto)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Receita vs Gastos */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide leading-none">Receita</p>
                      <p key={resumoCaixa.receitaTotal} className="text-sm font-bold text-emerald-700 num mt-0.5 value-update">{fmt(resumoCaixa.receitaTotal)}</p>
                    </div>
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-2xl p-3 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide leading-none">Gastos</p>
                      <p key={resumoCaixa.totalGastos} className="text-sm font-bold text-red-600 num mt-0.5 value-update">{fmt(resumoCaixa.totalGastos)}</p>
                    </div>
                  </div>
                </div>

                {/* Commitment bar */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-gray-500">Comprometimento da renda</span>
                    <span className={`text-xs font-bold num ${comprometimentoColor}`}>
                      {resumoCaixa.percentualComprometimento.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      key={resumoCaixa.percentualComprometimento}
                      className={`h-2 rounded-full bar-enter ${comprometimentoBarColor}`}
                      style={{ '--bar-w': `${Math.min(resumoCaixa.percentualComprometimento, 100)}%` } as React.CSSProperties}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-gray-300">0%</span>
                    <span className="text-[10px] text-amber-400">70%</span>
                    <span className="text-[10px] text-red-400">90%</span>
                    <span className="text-[10px] text-gray-300">100%</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Indicadores secundários ── */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-3">
              {carregando ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                  <div className="h-5 bg-gray-100 rounded w-full" />
                </div>
              ) : (
                <div className="content-enter">
                  <div className="flex items-center gap-1 mb-1.5">
                    <Wallet className="w-3 h-3 text-gray-400" />
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Fixas</p>
                  </div>
                  <p key={resumoCaixa.contasFixas} className="text-sm font-bold text-gray-700 num value-update">{fmt(resumoCaixa.contasFixas)}</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-3">
              {carregando ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                  <div className="h-5 bg-gray-100 rounded w-full" />
                </div>
              ) : (
                <div className="content-enter">
                  <div className="flex items-center gap-1 mb-1.5">
                    <CreditCard className="w-3 h-3 text-gray-400" />
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Fatura</p>
                  </div>
                  <p key={resumoCaixa.fatura} className="text-sm font-bold text-gray-700 num value-update">{fmt(resumoCaixa.fatura)}</p>
                  {resumoCaixa.faturaEhPrevisto && (
                    <p className="text-[10px] text-amber-600 font-medium mt-0.5">estimado</p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-3">
              {carregando ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                  <div className="h-5 bg-gray-100 rounded w-full" />
                </div>
              ) : (
                <div className="content-enter">
                  <div className="flex items-center gap-1 mb-1.5">
                    <PiggyBank className="w-3 h-3 text-violet-400" />
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Investido</p>
                  </div>
                  <p key={totalInvestido} className="text-sm font-bold text-violet-700 num value-update">{fmt(totalInvestido)}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── 3. Cartões de crédito ── */}
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
              <div className="content-enter">
                {/* NuBank total */}
                <div className="mb-3 pb-3 border-b border-gray-100">
                  <div className="flex items-baseline justify-between">
                    <p className="text-3xl font-bold text-gray-900 num">{fmt(fatura.totalRealizado)}</p>
                    <span className="text-xs text-gray-400">total atual</span>
                  </div>
                </div>

                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">NuBank</p>
                <div className="grid grid-cols-2 gap-3">
                  {/* Matheus NuBank */}
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                    <div className="h-[3px] bg-blue-300 opacity-70" />
                    <div className="p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Matheus</p>
                      </div>
                      <div className="mb-2">
                        <p className="text-lg font-bold text-gray-900 num truncate">{fmt(fatura.matheusAtual)}</p>
                        <p className="text-[10px] text-gray-400 num mt-0.5">de {fmt(fatura.matheusPrevisto)}</p>
                      </div>
                      {assinaturasNaopagas.matheus > 0 && (
                        <div className="flex justify-between text-[10px] gap-1 mb-1 text-indigo-500">
                          <span>Assinaturas</span>
                          <span className="font-medium num">{fmt(assinaturasNaopagas.matheus)}</span>
                        </div>
                      )}
                      {assinaturasDivergentes.matheus.length > 0 && (
                        <div className="mb-1">
                          {assinaturasDivergentes.matheus.map((d) => (
                            <div key={d.nome} className="flex justify-between text-[10px] gap-1 text-amber-600">
                              <span className="truncate shrink" title={d.nome}>⚠ {d.nome}</span>
                              <span className="font-medium num shrink-0 whitespace-nowrap">
                                {d.diff > 0 ? '+' : ''}{fmt(d.diff)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {fatura.matheusProjecaoParcelas > 0 && (
                        <div className="flex justify-between items-center gap-1 mb-1 text-[10px]">
                          <span className="text-gray-400 whitespace-nowrap shrink-0">Parc. prev.</span>
                          <span className="font-medium text-orange-600 num whitespace-nowrap">− {fmt(fatura.matheusProjecaoParcelas)}</span>
                        </div>
                      )}
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-0.5">
                        <div key={fatura.matheusAtual} className="h-full bg-blue-400 rounded-full bar-enter" style={{ '--bar-w': `${fatura.matheusPrevisto > 0 ? Math.min(100, (fatura.matheusAtual / fatura.matheusPrevisto) * 100) : 0}%` } as React.CSSProperties} />
                      </div>
                      <p className="text-right text-[10px] text-gray-400 num mb-2">{fatura.matheusPrevisto > 0 ? Math.min(100, (fatura.matheusAtual / fatura.matheusPrevisto) * 100).toFixed(0) : 0}%</p>
                      <div className={`rounded-lg px-2.5 py-1.5 ${
                        fatura.sobraMatheus < 0 ? 'bg-red-50 text-red-600' : matheusSobraWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        <div className="flex items-center gap-1 text-[10px] font-medium">
                          {fatura.sobraMatheus < 0 ? <><AlertTriangle className="w-3 h-3" /> Excesso</> : matheusSobraWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção</> : '✓ Restante'}
                        </div>
                        <p className="text-sm font-bold num mt-0.5">{fmt(Math.abs(fatura.sobraMatheus))}</p>
                      </div>
                    </div>
                  </div>

                  {/* Jeniffer NuBank */}
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                    <div className="h-[3px] bg-pink-300 opacity-70" />
                    <div className="p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-pink-400 shrink-0" />
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Jeniffer</p>
                      </div>
                      <div className="mb-2">
                        <p className="text-lg font-bold text-gray-900 num truncate">{fmt(fatura.jenifferAtual)}</p>
                        <p className="text-[10px] text-gray-400 num mt-0.5">de {fmt(fatura.jenifferPrevisto)}</p>
                      </div>
                      {assinaturasNaopagas.jeniffer > 0 && (
                        <div className="flex justify-between text-[10px] gap-1 mb-1 text-indigo-500">
                          <span>Assinaturas</span>
                          <span className="font-medium num">{fmt(assinaturasNaopagas.jeniffer)}</span>
                        </div>
                      )}
                      {assinaturasDivergentes.jeniffer.length > 0 && (
                        <div className="mb-1">
                          {assinaturasDivergentes.jeniffer.map((d) => (
                            <div key={d.nome} className="flex justify-between text-[10px] gap-1 text-amber-600">
                              <span className="truncate shrink" title={d.nome}>⚠ {d.nome}</span>
                              <span className="font-medium num shrink-0 whitespace-nowrap">
                                {d.diff > 0 ? '+' : ''}{fmt(d.diff)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {fatura.jenifferProjecaoParcelas > 0 && (
                        <div className="flex justify-between items-center gap-1 mb-1 text-[10px]">
                          <span className="text-gray-400 whitespace-nowrap shrink-0">Parc. prev.</span>
                          <span className="font-medium text-orange-600 num whitespace-nowrap">− {fmt(fatura.jenifferProjecaoParcelas)}</span>
                        </div>
                      )}
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-0.5">
                        <div key={fatura.jenifferAtual} className="h-full bg-pink-400 rounded-full bar-enter" style={{ '--bar-w': `${fatura.jenifferPrevisto > 0 ? Math.min(100, (fatura.jenifferAtual / fatura.jenifferPrevisto) * 100) : 0}%` } as React.CSSProperties} />
                      </div>
                      <p className="text-right text-[10px] text-gray-400 num mb-2">{fatura.jenifferPrevisto > 0 ? Math.min(100, (fatura.jenifferAtual / fatura.jenifferPrevisto) * 100).toFixed(0) : 0}%</p>
                      <div className={`rounded-lg px-2.5 py-1.5 ${
                        fatura.sobraJeniffer < 0 ? 'bg-red-50 text-red-600' : jenifferSobraWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        <div className="flex items-center gap-1 text-[10px] font-medium">
                          {fatura.sobraJeniffer < 0 ? <><AlertTriangle className="w-3 h-3" /> Excesso</> : jenifferSobraWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção</> : '✓ Restante'}
                        </div>
                        <p className="text-sm font-bold num mt-0.5">{fmt(Math.abs(fatura.sobraJeniffer))}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Conjunto NuBank */}
                {(fatura.conjuntoAtual > 0 || fatura.conjuntoPrevisto > 0 || fatura.conjuntoItemExiste) && (
                  <div className="mt-3 bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                    <div className="h-[3px] bg-purple-300 opacity-70" />
                    <div className="p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Conjunto</p>
                      </div>
                      <div className="mb-2">
                        <p className="text-lg font-bold text-gray-900 num truncate">{fmt(fatura.conjuntoAtual)}</p>
                        {fatura.conjuntoPrevisto > 0 && (
                          <p className="text-[10px] text-gray-400 num mt-0.5">de {fmt(fatura.conjuntoPrevisto)}</p>
                        )}
                      </div>
                      {fatura.conjuntoProjecaoParcelas > 0 && (
                        <div className="flex justify-between items-center gap-1 mb-1 text-[10px]">
                          <span className="text-gray-400 whitespace-nowrap shrink-0">Parc. prev.</span>
                          <span className="font-medium text-orange-600 num whitespace-nowrap">− {fmt(fatura.conjuntoProjecaoParcelas)}</span>
                        </div>
                      )}
                      {fatura.conjuntoPrevisto > 0 && (
                        <>
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-0.5">
                            <div key={fatura.conjuntoAtual} className="h-full bg-purple-400 rounded-full bar-enter" style={{ '--bar-w': `${fatura.conjuntoPrevisto > 0 ? Math.min(100, (fatura.conjuntoAtual / fatura.conjuntoPrevisto) * 100) : 0}%` } as React.CSSProperties} />
                          </div>
                          <p className="text-right text-[10px] text-gray-400 num mb-2">{fatura.conjuntoPrevisto > 0 ? Math.min(100, (fatura.conjuntoAtual / fatura.conjuntoPrevisto) * 100).toFixed(0) : 0}%</p>
                          <div className={`rounded-lg px-2.5 py-1.5 ${
                            fatura.sobraConjunto < 0 ? 'bg-red-50 text-red-600' : fatura.conjuntoPrevisto > 0 && (fatura.sobraConjunto / fatura.conjuntoPrevisto) * 100 <= 10 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            <div className="flex items-center gap-1 text-[10px] font-medium">
                              {fatura.sobraConjunto < 0 ? <><AlertTriangle className="w-3 h-3" /> Excesso</> : fatura.conjuntoPrevisto > 0 && (fatura.sobraConjunto / fatura.conjuntoPrevisto) * 100 <= 10 ? <><AlertTriangle className="w-3 h-3" /> Atenção</> : '✓ Restante'}
                            </div>
                            <p className="text-sm font-bold num mt-0.5">{fmt(Math.abs(fatura.sobraConjunto))}</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Outros cartões */}
                {cartaoExtrasData && (() => {
                  const { outrosCards, matheusTotalPrevisto, matheusTotalAtual, matheusRestante, matheusPct, matheusResumoWarning, jenifferTotalPrevisto, jenifferTotalAtual, jenifferRestante, jenifferPct, jenifferResumoWarning } = cartaoExtrasData
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-100 opacity-80">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Outros cartões</p>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        {outrosCards.map((card, i) => {
                          const sobra = Math.round((card.previsto - card.atual) * 100) / 100
                          const pct = card.previsto > 0 ? Math.min(100, (card.atual / card.previsto) * 100) : 0
                          const pctRestante = card.previsto > 0 ? (sobra / card.previsto) * 100 : 100
                          const isWarning = sobra >= 0 && pctRestante <= 10
                          const isMatheus = card.responsavel === 'Matheus'
                          return (
                            <div key={i} className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                              <div className={`h-[2px] opacity-60 ${isMatheus ? 'bg-blue-300' : 'bg-pink-300'}`} />
                              <div className="p-2.5">
                                <div className="flex items-center gap-1 mb-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isMatheus ? 'bg-blue-400' : 'bg-pink-400'}`} />
                                  <p className="font-semibold text-[11px] text-gray-500 truncate">{card.label}</p>
                                </div>
                                <div className="mb-1.5">
                                  <p className="text-sm font-bold text-gray-900 num truncate">{fmt(card.atual)}</p>
                                  <p className="text-[10px] text-gray-400 num mt-0.5">de {fmt(card.previsto)}</p>
                                </div>
                                <div className={`h-1 rounded-full overflow-hidden mb-0.5 ${isMatheus ? 'bg-blue-100' : 'bg-pink-100'}`}>
                                  <div key={`${i}-${card.atual}`} className={`h-full rounded-full bar-enter ${isMatheus ? 'bg-blue-400' : 'bg-pink-400'}`} style={{ '--bar-w': `${pct}%` } as React.CSSProperties} />
                                </div>
                                <div className={`rounded-md px-1.5 py-1 mt-1.5 ${
                                  sobra < 0 ? 'bg-red-50 text-red-600' : isWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-700'
                                }`}>
                                  <div className="flex items-center gap-0.5 text-[10px] font-medium">
                                    {sobra < 0 ? <><AlertTriangle className="w-3 h-3" /> Excesso</> : isWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção</> : '✓ Restante'}
                                  </div>
                                  <p className="text-xs font-bold num mt-0.5">{fmt(Math.abs(sobra))}</p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-3 mb-2">Resumo por pessoa</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                          <div className="h-[2px] bg-blue-300 opacity-60" />
                          <div className="p-2.5">
                            <div className="flex items-center gap-1 mb-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Matheus</p>
                            </div>
                            <div className="mb-1.5">
                              <p className="text-sm font-bold text-gray-900 num truncate">{fmt(matheusTotalAtual)}</p>
                              <p className="text-[10px] text-gray-400 num mt-0.5">de {fmt(matheusTotalPrevisto)}</p>
                            </div>
                            <div className="h-1 bg-blue-100 rounded-full overflow-hidden mb-0.5">
                              <div key={matheusTotalAtual} className="h-full bg-blue-400 rounded-full bar-enter" style={{ '--bar-w': `${matheusPct}%` } as React.CSSProperties} />
                            </div>
                            <div className={`rounded-lg px-2 py-1 mt-1.5 ${matheusRestante < 0 ? 'bg-red-50 text-red-600' : matheusResumoWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-700'}`}>
                              <div className="flex items-center gap-0.5 text-[10px] font-medium">{matheusRestante < 0 ? <><AlertTriangle className="w-3 h-3" /> Excesso</> : matheusResumoWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção</> : '✓ Restante'}</div>
                              <p className="text-xs font-bold num mt-0.5">{fmt(Math.abs(matheusRestante))}</p>
                            </div>
                          </div>
                        </div>
                        <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                          <div className="h-[2px] bg-pink-300 opacity-60" />
                          <div className="p-2.5">
                            <div className="flex items-center gap-1 mb-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-pink-400 shrink-0" />
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Jeniffer</p>
                            </div>
                            <div className="mb-1.5">
                              <p className="text-sm font-bold text-gray-900 num truncate">{fmt(jenifferTotalAtual)}</p>
                              <p className="text-[10px] text-gray-400 num mt-0.5">de {fmt(jenifferTotalPrevisto)}</p>
                            </div>
                            <div className="h-1 bg-pink-100 rounded-full overflow-hidden mb-0.5">
                              <div key={jenifferTotalAtual} className="h-full bg-pink-400 rounded-full bar-enter" style={{ '--bar-w': `${jenifferPct}%` } as React.CSSProperties} />
                            </div>
                            <div className={`rounded-lg px-2 py-1 mt-1.5 ${jenifferRestante < 0 ? 'bg-red-50 text-red-600' : jenifferResumoWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-700'}`}>
                              <div className="flex items-center gap-0.5 text-[10px] font-medium">{jenifferRestante < 0 ? <><AlertTriangle className="w-3 h-3" /> Excesso</> : jenifferResumoWarning ? <><AlertTriangle className="w-3 h-3" /> Atenção</> : '✓ Restante'}</div>
                              <p className="text-xs font-bold num mt-0.5">{fmt(Math.abs(jenifferRestante))}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* ── 4. Insights com IA ── */}
          {isSameMonth(mesAtual, new Date()) && <InsightsCard />}

          {/* ── 5. Investimentos ── */}
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
                <div className="animate-pulse space-y-2.5">
                  <div className="h-20 bg-gray-100 rounded-2xl" />
                  <div className="h-20 bg-gray-100 rounded-2xl" />
                </div>
              ) : (
                <div className="content-enter space-y-2.5">
                  {investimentos.map((inv) => {
                    const meta = resumoCaixa.sobraLiquida > 0 ? resumoCaixa.sobraLiquida * inv.percentual / 100 : 0
                    const metaPrevista = resumoCaixa.saldoPrevisto > 0 ? resumoCaixa.saldoPrevisto * inv.percentual / 100 : 0
                    const progresso = meta > 0 ? Math.min((inv.aportado / meta) * 100, 100) : 0
                    const concluido = meta > 0 && inv.aportado >= meta
                    const pct = Math.round(progresso)
                    return (
                      <div key={inv.id} className="bg-gray-50 rounded-2xl p-3.5">
                        {/* Name + badge */}
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${concluido ? 'bg-emerald-500' : 'bg-violet-400'}`} />
                            <span className="text-sm font-semibold text-gray-700 truncate">{inv.descricao}</span>
                          </div>
                          {concluido ? (
                            <span className="text-[10px] font-bold text-white bg-emerald-500 rounded-full px-2 py-0.5 shrink-0">✓ Calc. Atual</span>
                          ) : (
                            <span className={`text-[11px] font-bold num text-white rounded-full px-2 py-0.5 shrink-0 ${
                              pct >= 80 ? 'bg-amber-400' : 'bg-violet-500'
                            }`}>{pct}%</span>
                          )}
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2.5 overflow-hidden">
                          <div
                            key={`${inv.id}-${inv.aportado}`}
                            className={`h-full rounded-full bar-enter ${
                              concluido
                                ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                : pct >= 80
                                ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                                : 'bg-gradient-to-r from-violet-400 to-violet-500'
                            }`}
                            style={{ '--bar-w': `${progresso}%` } as React.CSSProperties}
                          />
                        </div>

                        {/* Aportado / meta */}
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-base font-bold num ${concluido ? 'text-emerald-600' : 'text-gray-800'}`}>
                            {fmt(inv.aportado)}
                          </span>
                          <div className="text-right">
                            <span className="text-xs text-gray-400 num">Calculado Atual {fmt(meta)}</span>
                            {metaPrevista !== meta && metaPrevista > 0 && (
                              <span className="block text-[10px] text-gray-500 num">Previsto {fmt(metaPrevista)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Total row */}
                  {investimentos.length > 0 && (
                    <div className="flex items-center justify-between px-1 pt-1">
                      <span className="text-xs text-gray-400 font-medium">Total aportado</span>
                      <span className="text-sm font-bold text-violet-700 num">{fmt(totalInvestido)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>{/* /resumo */}

        {/* ── Gráficos tab ── */}
        {graficosAbertos && (
          <div key={`graficos-${aba}`} className={aba === 'graficos' ? 'tab-content-enter space-y-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start' : 'hidden'}>

            <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4 text-violet-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  Gastos Diários
                  <InfoPopover texto="Evolução dos gastos ao longo dos dias do mês selecionado. Considera todas as compras com data de compra registrada no período. Use os filtros para visualizar por pessoa ou por cartão." />
                </h2>
                <div className="inline-flex items-center bg-gray-100 rounded-full p-[2px] gap-[1px] ml-auto shrink-0">
                  <button
                    onClick={() => setVisaoGastosDiarios('valor')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all duration-200 ${
                      visaoGastosDiarios === 'valor'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <TrendingUp className="w-2.5 h-2.5" />
                    Valor
                  </button>
                  <button
                    onClick={() => setVisaoGastosDiarios('burndown')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all duration-200 ${
                      visaoGastosDiarios === 'burndown'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <BarChart2 className="w-2.5 h-2.5" />
                    Burndown
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4 ml-10">
                {visaoGastosDiarios === 'burndown' ? 'Consumo do previsto · Toque para detalhes' : 'Dia a dia · Toque para detalhes'}
              </p>
              <GraficoGastosDiarios
                mesAtual={mesAtual}
                cartao1Nome={fatura.cartao1Nome}
                cartao2Nome={fatura.cartao2Nome}
                visao={visaoGastosDiarios}
                onVisaoChange={setVisaoGastosDiarios}
                previsto={{ matheus: fatura.matheusPrevisto, jeniffer: fatura.jenifferPrevisto, cartao1: fatura.cartao1Previsto, cartao2: fatura.cartao2Previsto }}
                dataFechamentoFatura={dataFechamentoNubank}
              />
            </div>

            <LimitesCategorias mesAtual={mesAtual} />

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

            <div className="lg:col-span-1">
              <CategoryTreemap mesAtual={mesAtual} />
            </div>

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

            <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 lg:col-span-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-800">
                  Visão Anual {new Date().getFullYear()}
                </h2>
              </div>
              <p className="text-xs text-gray-400 mb-4 ml-10">Receitas, despesas e saldo mês a mês</p>
              <GraficoAnual ano={mesAtual.getFullYear()} />
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
