'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, endOfMonth, addMonths, subMonths, isSameMonth } from 'date-fns'
import { calcularDataFechamentoDaFatura } from '@/lib/fatura'
import { valorEfetivoNoMes } from '@/lib/assinaturaValor'
import { classificarTipoGasto, somarValorFatura, type TipoGasto } from '@/lib/composicaoFatura'
import { BarChart2, BarChart3, CreditCard, Wallet, PiggyBank, TrendingUp, TrendingDown, Minus, LineChart, Activity } from 'lucide-react'
import { ptBR } from 'date-fns/locale'
import { useMes } from '@/components/MesProvider'
import MonthSelector from '@/components/MonthSelector'
import UltimaImportacaoInfo from '@/components/UltimaImportacaoInfo'
import type { ComposicaoFaturaDados } from '@/components/ComposicaoFaturaModal'
import { useInsights } from '@/lib/useInsights'
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
const ComposicaoFaturaModal = dynamic(() => import('@/components/ComposicaoFaturaModal'), { ssr: false })
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
import { tipoCartaoPorItem, removerPrefixoCartao, ehLinhaDeReceita } from '@/lib/tipoCartao'
import {
  calcularResumoSaldo, calcularReceitaTotal,
  type PlanejamentoSaldoRow, type TransacaoSaldoRow,
} from '@/lib/faturaEfetiva'
import { cartaoLabelsDePlanejamento } from '@/lib/cartaoLabels'
import { estiloResponsavel, ordenarResponsaveis } from '@/lib/responsavelStyle'
import BlocoFaturaPrincipal, {
  type BlocoPrincipal, type ProjecaoItem, type ComposicaoGastos, type AssinDivergente,
} from '@/components/BlocoFaturaPrincipal'

// Isola a chamada do hook (fetch + Realtime) num componente à parte, montado só
// quando o card de insights é exibido — chamar useInsights() direto no Dashboard
// faria o fetch/subscribe rodar mesmo fora do mês atual, quando o card não aparece.
function DashboardInsights() {
  const insightsState = useInsights()
  return <InsightsCard state={insightsState} title="Insights por IA" />
}

/** Um cartão extra (Cartão 1/2): agregado por cartão, não por responsável. */
interface BlocoCartaoExtra {
  tipo: 'cartao1' | 'cartao2'
  label: string
  responsavelDono: string | null
  previsto: number
  atual: number
}

interface TotalResponsavel {
  responsavel: string
  previsto: number
  atual: number
}


interface FaturaState {
  totalRealizado: number
  principalBlocks: BlocoPrincipal[]
  cartoesExtras: BlocoCartaoExtra[]
  totaisPorResponsavel: TotalResponsavel[]
  cartao1Nome: string
  cartao2Nome: string
  cartao1Previsto: number
  cartao2Previsto: number
  principalPrevistoPorResponsavel: Record<string, number>
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
    { data: assinaturasHistoricoData },
    { data: maxFaturaRowData },
  ] = await Promise.all([
    // Busca todas as transações do período em uma única query e separa por cartão no cliente
    // Não filtra ESTORNO/ESTORNADO aqui: precisamos do status e do conciliacao_ref
    // para tratar estornos sem par (crédito não conciliado com a compra original)
    // corretamente em somarValorFatura — ver comentário na função.
    supabase.from('transacoes_nubank').select('valor, responsavel, descricao, cartao, parcela_atual, total_parcelas, status, conciliacao_ref').eq('projeto_fatura', mesRefFatura),
    supabase.from('planejamento').select('item, responsavel, valor_previsto, pago, valor_real').eq('mes_referencia', mesRef),
    // Busca aportes embutidos para eliminar a query sequencial posterior
    supabase.from('investimentos').select('id, descricao, percentual, investimentos_aportes(valor)').eq('mes_referencia', mesRef).order('created_at', { ascending: true }),
    supabase.from('configuracoes').select('chave, valor').in('chave', ['dia_vencimento', 'ajuste_fechamento']),
    supabase.from('faturas').select('data_fechamento').eq('cartao', 'nubank').eq('mes_referencia', mesRefFatura).limit(1),
    supabase.from('assinaturas').select('id, nome, valor, responsavel, ativa, moeda').eq('cartao', 'nubank'),
    supabase.from('assinaturas_historico').select('assinatura_id, valor, vigente_desde, criado_em'),
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

  const totalRealizado = somarValorFatura(transacoesFatura ?? [])

  const planRows = (planejamento || []) as PlanejamentoSaldoRow[]
  const labelsCartao = cartaoLabelsDePlanejamento(planRows)

  // Cada linha [PRINCIPAL] é um cartão adicional da fatura. O responsável da linha é
  // o que liga a despesa às transações importadas — antes isso era adivinhado a
  // partir do nome do item ("NuBank Conjunto") em quatro literais hardcoded.
  const linhasPrincipal = planRows.filter(p => tipoCartaoPorItem(p.item) === 'principal')

  const previstoPrincipalPorResponsavel: Record<string, number> = {}
  const nomesPrincipalPorResponsavel: Record<string, string[]> = {}
  for (const p of linhasPrincipal) {
    const resp = p.responsavel || 'Sem responsável'
    previstoPrincipalPorResponsavel[resp] = (previstoPrincipalPorResponsavel[resp] ?? 0) + (p.valor_previsto ?? 0)
    ;(nomesPrincipalPorResponsavel[resp] ??= []).push(removerPrefixoCartao(p.item))
  }

  // Um bloco por despesa cadastrada — e só. Semear esta lista também com os
  // responsáveis das transações criava um bloco em branco (previsto R$ 0, exibido
  // como "Excesso") para quem tem compra lançada mas nenhuma despesa do principal.
  // O gasto desse responsável continua no "Total atual" e no saldo; ele só não
  // ganha barra própria enquanto não existir uma despesa para ele.
  const responsaveisPrincipal = new Set<string>(Object.keys(previstoPrincipalPorResponsavel))

  const receitaTotal = calcularReceitaTotal(planRows)
  const faturaEhPrevisto = totalRealizado === 0

  // Projeção de parcelas por responsável. Antes eram três acumuladores fixos com um
  // if/else encadeado; num mapa, um quarto responsável simplesmente funciona.
  const projecaoPorResponsavel = new Map<string, { valor: number; itens: ProjecaoItem[] }>()
  const projecaoDe = (responsavel: string) => {
    let entrada = projecaoPorResponsavel.get(responsavel)
    if (!entrada) { entrada = { valor: 0, itens: [] }; projecaoPorResponsavel.set(responsavel, entrada) }
    return entrada
  }
  if (faturaEhPrevisto) {
    const mesProjecao = startOfMonth(addMonths(mes, 1))

    if (maxFaturaRowData?.[0]?.projeto_fatura) {
      const { data: transacoesBase } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura, descricao, valor, responsavel, parcela_atual, total_parcelas')
        .eq('cartao', 'nubank').eq('projeto_fatura', maxFaturaRowData[0].projeto_fatura)
        .neq('status', 'ESTORNO').neq('status', 'ESTORNADO')

      const contratos = new Map<string, { fatura: Date; atual: number; total: number; valor: number; responsavel: string; descricao: string }>()

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
        // Inclui o valor na chave: duas compras distintas podem ter descrição, total de
        // parcelas, responsável e mês de origem idênticos, mas o valor cobrado as diferencia.
        const key = `${format(origem, 'yyyy-MM')}|${descBase}|${total}|${t.responsavel}|${t.valor.toFixed(2)}`
        const existing = contratos.get(key)
        if (!existing || faturaDate > existing.fatura) {
          contratos.set(key, { fatura: faturaDate, atual, total, valor: t.valor, responsavel: t.responsavel, descricao })
        }
      }

      for (const { fatura: faturaDate, atual, total, valor, responsavel, descricao } of contratos.values()) {
        const deltaM = (mesProjecao.getFullYear() - faturaDate.getFullYear()) * 12 + (mesProjecao.getMonth() - faturaDate.getMonth())
        const parcelaNoMes = atual + deltaM
        if (parcelaNoMes >= 1 && parcelaNoMes <= total) {
          const descAjustada = /parcela\s+\d+\/\d+/i.test(descricao)
            ? descricao.replace(/parcela\s+\d+\/\d+/i, `Parcela ${parcelaNoMes}/${total}`)
            : descricao.replace(/\b\d{1,2}\/\d{1,2}\b/, `${parcelaNoMes}/${total}`)
          const item: ProjecaoItem = { descricao: descAjustada, valor, responsavel, cartao: 'nubank', parcela_atual: parcelaNoMes, total_parcelas: total }
          const entrada = projecaoDe(responsavel)
          entrada.valor += valor
          entrada.itens.push(item)
          responsaveisPrincipal.add(responsavel)
        }
      }
    }
  }

  // Cartões extras: agregados por CARTÃO, não por cartão × responsável. Uma despesa
  // nova em Cartão 1 sobe o total daquela linha em vez de criar uma linha nova.
  const cartoesExtras: BlocoCartaoExtra[] = (['cartao1', 'cartao2'] as const).map(tipo => {
    const linhas = planRows.filter(p => tipoCartaoPorItem(p.item) === tipo)
    const tx = tipo === 'cartao1' ? transacoesC1 : transacoesC2
    const donos = new Set(linhas.map(p => p.responsavel || '').filter(Boolean))
    return {
      tipo,
      label: labelsCartao[tipo],
      responsavelDono: donos.size === 1 ? [...donos][0] : null,
      previsto: linhas.reduce((acc, p) => acc + (p.valor_previsto ?? 0), 0),
      atual: somarValorFatura(tx),
    }
  }).filter(c => c.previsto > 0 || c.atual > 0)

  // Saldo, contas fixas e fatura efetiva vêm de lib/faturaEfetiva — a mesma conta que
  // Finanças e o pré-cache usam, em vez das três cópias que existiam antes.
  const {
    faturaEfetiva,
    contasFixas: contasFixasAtual,
    temLancamentosEfetivos,
    totalGastos,
    saldo: sobraLiquida,
    saldoPrevisto,
  } = calcularResumoSaldo(planRows, (todasTransacoesFatura || []) as TransacaoSaldoRow[])

  const despesasItems = planRows.filter(p => !ehLinhaDeReceita(p.item))
  const todasDespesasPagas = despesasItems.length > 0 && despesasItems.every(p => p.pago)

  const percentualComprometimento = receitaTotal > 0 ? (totalGastos / receitaTotal) * 100 : 0

  type AssinaturaRow = { id: string; nome: string; valor: number; responsavel: string; ativa: boolean; moeda: string }
  type TransacaoRow = { valor: number; responsavel: string | null; descricao: string | null; parcela_atual?: number | null; total_parcelas?: number | null }
  const assinAtivas = (assinaturasData || []).filter((a: AssinaturaRow) => a.ativa)
  // Composição (barras existente/novo/assinatura) e checagem de assinaturas usam só os
  // lançamentos "reais" da fatura — estornos (créditos) e compras já estornadas não fazem
  // sentido como segmento de barra; o valor deles já é tratado à parte em somarValorFatura.
  const txFaturaList: TransacaoRow[] = (transacoesFatura || []).filter(
    t => t.status !== 'ESTORNO' && t.status !== 'ESTORNADO'
  )
  const historicoValores = assinaturasHistoricoData || []
  // Mesmo cutoff usado em AssinaturasMensal.tsx (endOfMonth do mês selecionado) para resolver
  // o valor vigente da assinatura na fatura exibida, respeitando alterações de preço registradas.
  const cutoffHistorico = format(endOfMonth(mes), 'yyyy-MM-dd')
  const valorAssinaturaNoMes = (a: AssinaturaRow) =>
    valorEfetivoNoMes(a.id, a.valor, cutoffHistorico, historicoValores)
  const calcNaoPaga = (responsavel: string) =>
    assinAtivas
      .filter((a: AssinaturaRow) => a.responsavel === responsavel && !txFaturaList.some((tx: TransacaoRow) => tx.descricao?.toLowerCase().includes(a.nome.toLowerCase())))
      .reduce((sum: number, a: AssinaturaRow) => sum + valorAssinaturaNoMes(a), 0)
  type AssinDivergenteLocal = AssinDivergente
  const calcDivergente = (responsavel: string): AssinDivergenteLocal[] =>
    assinAtivas
      .filter((a: AssinaturaRow) => a.responsavel === responsavel)
      .flatMap((a: AssinaturaRow) => {
        const nome = a.nome.toLowerCase()
        const matches = txFaturaList.filter((tx: TransacaoRow) =>
          tx.descricao?.toLowerCase().includes(nome)
        )
        if (matches.length === 0) return []
        const valorEsperado = valorAssinaturaNoMes(a)
        // Assinaturas em moeda estrangeira oscilam com o câmbio: tolerância percentual em vez de fixa.
        const tolerancia = a.moeda !== 'BRL' ? valorEsperado * 0.05 : 0.05
        if (matches.some((tx: TransacaoRow) => Math.abs(tx.valor - valorEsperado) <= tolerancia)) return []
        const best = matches.reduce((prev: TransacaoRow, cur: TransacaoRow) =>
          Math.abs(cur.valor - valorEsperado) < Math.abs(prev.valor - valorEsperado) ? cur : prev
        )
        return [{ nome: a.nome, valorEsperado, valorCobrado: best.valor, diff: best.valor - valorEsperado }]
      })

  // Decompõe o valor gasto (atual) de cada responsável em: parcelas pré-existentes (2/X em diante),
  // novas parcelas/compras à vista (1/X) e assinaturas — para exibir sobreposto na barra da fatura.
  function montarComposicao(responsavel: string): ComposicaoGastos {
    let existente = 0, novo = 0, assinatura = 0
    for (const t of txFaturaList.filter((tx: TransacaoRow) => tx.responsavel === responsavel)) {
      const tipo = classificarTipoGasto(t.descricao, t.parcela_atual, t.total_parcelas, t.responsavel, assinAtivas)
      if (tipo === 'assinatura') assinatura += t.valor
      else if (tipo === 'existente') existente += t.valor
      else novo += t.valor
    }
    return { existente, novo, assinatura }
  }

  // Um bloco por cartão adicional do principal. Todas as funções acima já são
  // parametrizadas por responsável, então cada bloco é só uma chamada de cada.
  const principalBlocks: BlocoPrincipal[] = ordenarResponsaveis([...responsaveisPrincipal], 'Matheus')
    .map(responsavel => {
      const previsto = previstoPrincipalPorResponsavel[responsavel] ?? 0
      const atual = somarValorFatura(transacoesFatura.filter(t => (t.responsavel || '') === responsavel))
      const projecao = projecaoPorResponsavel.get(responsavel) ?? { valor: 0, itens: [] }
      const assinaturasNaoPagas = calcNaoPaga(responsavel)
      return {
        responsavel,
        nomes: nomesPrincipalPorResponsavel[responsavel] ?? [],
        previsto,
        atual,
        projecaoParcelas: projecao.valor,
        projecaoItens: projecao.itens,
        composicao: montarComposicao(responsavel),
        assinaturasNaoPagas,
        assinaturasDivergentes: calcDivergente(responsavel),
        sobra: previsto - atual - projecao.valor - assinaturasNaoPagas,
      }
    })
    .filter(b => b.previsto > 0 || b.atual > 0 || b.projecaoParcelas > 0)

  // Totais consolidando principal + cartões extras. São tiles POR PESSOA: "Conjunto"
  // não é uma pessoa e já aparece na barra da fatura logo acima, então um tile dele
  // aqui só duplicaria o número e apertaria a grade para três colunas.
  const totaisPorResponsavel: TotalResponsavel[] = ordenarResponsaveis(
    [...new Set([
      ...principalBlocks.map(b => b.responsavel),
      ...planRows.filter(p => { const t = tipoCartaoPorItem(p.item); return t === 'cartao1' || t === 'cartao2' })
        .map(p => p.responsavel || '').filter(Boolean),
    ])].filter(r => r !== 'Conjunto'),
    'Matheus'
  ).map(responsavel => {
    const bloco = principalBlocks.find(b => b.responsavel === responsavel)
    const linhasExtras = planRows.filter(p => {
      const t = tipoCartaoPorItem(p.item)
      return (t === 'cartao1' || t === 'cartao2') && (p.responsavel || '') === responsavel
    })
    const txExtras = [...transacoesC1, ...transacoesC2].filter(t => (t.responsavel || '') === responsavel)
    return {
      responsavel,
      previsto: (bloco?.previsto ?? 0) + linhasExtras.reduce((acc, p) => acc + (p.valor_previsto ?? 0), 0),
      atual: (bloco?.atual ?? 0) + somarValorFatura(txExtras),
    }
  }).filter(t => t.previsto > 0 || t.atual > 0)

  return {
    fatura: {
      totalRealizado,
      principalBlocks,
      cartoesExtras,
      totaisPorResponsavel,
      cartao1Nome: labelsCartao.cartao1,
      cartao2Nome: labelsCartao.cartao2,
      cartao1Previsto: cartoesExtras.find(c => c.tipo === 'cartao1')?.previsto ?? 0,
      cartao2Previsto: cartoesExtras.find(c => c.tipo === 'cartao2')?.previsto ?? 0,
      principalPrevistoPorResponsavel: previstoPrincipalPorResponsavel,
    },
    resumoCaixa: {
      receitaTotal, contasFixas: contasFixasAtual,
      fatura: faturaEfetiva, faturaEhPrevisto: !temLancamentosEfetivos, extras: 0,
      totalGastos, sobraLiquida, saldoPrevisto, percentualComprometimento,
      todasDespesasPagas,
    },
    investimentos: (invData || []).map(i => ({ ...i, aportado: aportadoMap[i.id] || 0 })),
    dataFechamentoNubank,
  }
}

const FATURA_INICIAL: FaturaState = {
  totalRealizado: 0,
  principalBlocks: [],
  cartoesExtras: [],
  totaisPorResponsavel: [],
  cartao1Nome: 'Cartão 1',
  cartao2Nome: 'Cartão 2',
  cartao1Previsto: 0,
  cartao2Previsto: 0,
  principalPrevistoPorResponsavel: {},
}

const RESUMO_INICIAL: ResumoCaixaState = {
  receitaTotal: 0, contasFixas: 0, fatura: 0, faturaEhPrevisto: false, extras: 0,
  totalGastos: 0, sobraLiquida: 0, saldoPrevisto: 0, percentualComprometimento: 0,
  todasDespesasPagas: false,
}

export default function Dashboard() {
  const router = useRouter()
  const { mesAtual, setMesAtual } = useMes()

  const [dados, setDados] = useState<DashboardData>({
    fatura: FATURA_INICIAL,
    resumoCaixa: RESUMO_INICIAL,
    investimentos: [],
    dataFechamentoNubank: null,
  })

  const [seletorAberto, setSeletorAberto] = useState(false)
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<{ serie: string; mes: string; valor: number; itens: Record<string, unknown>[] } | null>(null)
  const [composicaoAberta, setComposicaoAberta] = useState(false)
  const [composicaoDados, setComposicaoDados] = useState<ComposicaoFaturaDados | null>(null)

  const abrirDetalhesProjecao = useCallback((responsavel: string, valor: number, itens: ProjecaoItem[]) => {
    setDetalhesPonto({
      serie: `Parcelas previstas — ${responsavel}`,
      mes: format(mesAtual, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase()),
      valor,
      itens: itens as unknown as Record<string, unknown>[],
    })
    setDrawerAberto(true)
  }, [mesAtual])
  const abrirComposicaoFatura = useCallback((responsavel: string, total: number, composicao: ComposicaoGastos) => {
    setComposicaoDados({
      responsavel,
      mes: format(mesAtual, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase()),
      mesRefFatura: format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM'),
      total,
      ...composicao,
    })
    setComposicaoAberta(true)
  }, [mesAtual])
  // Leva o usuário à tela de Compras já filtrada pelos mesmos lançamentos que
  // compõem o card em que ele deu duplo clique/toque no modal de composição.
  const verComprasDoTipo = useCallback((tipo: TipoGasto) => {
    if (!composicaoDados) return
    const params = new URLSearchParams({
      mes: composicaoDados.mesRefFatura,
      cartao: 'nubank',
      responsavel: composicaoDados.responsavel,
      tipo,
    })
    setComposicaoAberta(false)
    router.push(`/compras?${params.toString()}`)
  }, [composicaoDados, router])
  const [aba, setAba] = useState<'resumo' | 'graficos'>('resumo')
  const [graficosAbertos, setGraficosAbertos] = useState(false)
  const [visaoGastosDiarios, setVisaoGastosDiarios] = useState<'valor' | 'burndown'>('valor')
  const [emailUsuario, setEmailUsuario] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmailUsuario(user?.email ?? null)
    })
  }, [])

  const handleSetAba = useCallback((novaAba: 'resumo' | 'graficos') => {
    setAba(novaAba)
    if (novaAba === 'graficos') setGraficosAbertos(true)
  }, [])

  const { fatura, resumoCaixa, investimentos, dataFechamentoNubank } = dados

  const applyData = useCallback((data: unknown) => {
    setDados(data as DashboardData)
  }, [])

  const fetcher = useCallback(
    () => carregarDados(mesAtual),
    [mesAtual]
  )

  const { status, isOnline } = useGlobalSync({
    cacheKey: `dashboard-v2:${format(mesAtual, 'yyyy-MM')}`,
    tables: ['transacoes_nubank', 'planejamento', 'investimentos', 'investimentos_aportes'],
    fetcher,
    onData: applyData,
    pollInterval: 45_000,
  })

  useEffect(() => {
    if (!isOnline) return

    const prefetch = async (mes: Date) => {
      const storageKey = `datasync:dashboard-v2:${format(mes, 'yyyy-MM')}`
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

  const isMatheus = !emailUsuario || emailUsuario.toLowerCase().includes('matheus')

  const comprometimentoColor = useMemo(() =>
    resumoCaixa.percentualComprometimento > 90 ? 'text-red-600' :
    resumoCaixa.percentualComprometimento > 70 ? 'text-amber-600' :
    'text-emerald-600',
    [resumoCaixa.percentualComprometimento]
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

  // Blocos do principal na ordem de exibição: usuário logado primeiro.
  const blocosPrincipal = useMemo(
    () => ordenarResponsaveis(fatura.principalBlocks.map(b => b.responsavel), isMatheus ? 'Matheus' : 'Jeniffer')
      .map(r => fatura.principalBlocks.find(b => b.responsavel === r)!)
      .filter(Boolean),
    [fatura.principalBlocks, isMatheus]
  )

  const totalProjecaoParcelas = useMemo(
    () => fatura.principalBlocks.reduce((acc, b) => acc + b.projecaoParcelas, 0),
    [fatura.principalBlocks]
  )

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
            <h1 className="font-display italic text-xl text-gray-900 leading-tight mt-0.5">Dashboard</h1>
            <UltimaImportacaoInfo />
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
                  <p key={heroSaldo} className={`font-display text-4xl lg:text-5xl font-semibold num value-tight value-update ${heroColor}`}>
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
                  <div className="shrink-0 bg-gray-100 dark:bg-white/15 rounded-xl px-3 py-1.5 text-center">
                    <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-300 uppercase tracking-wide leading-none">Fecha</p>
                    <p className="text-sm font-bold text-gray-800 dark:text-white num leading-snug mt-0.5">{format(d, 'dd/MM')}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-300 leading-none mt-0.5">{format(d, 'EEEE', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}</p>
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
                {/* Total */}
                <div className="mb-6 pb-5 border-b border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Total atual</p>
                  {(() => {
                    const totalExibido = fatura.totalRealizado > 0 ? fatura.totalRealizado : totalProjecaoParcelas
                    const totalStr = fmt(totalExibido)
                    const commaIdx = totalStr.lastIndexOf(',')
                    const intPart = commaIdx >= 0 ? totalStr.slice(0, commaIdx) : totalStr
                    const decPart = commaIdx >= 0 ? totalStr.slice(commaIdx) : ''
                    return (
                      <>
                        <p className="text-4xl font-bold text-gray-900 num leading-none">
                          {intPart}<span className="text-gray-300">{decPart}</span>
                        </p>
                        {fatura.totalRealizado === 0 && totalProjecaoParcelas > 0 && (
                          <button
                            type="button"
                            onClick={() => abrirDetalhesProjecao('Todos', totalProjecaoParcelas, fatura.principalBlocks.flatMap(b => b.projecaoItens))}
                            className="text-[10px] text-orange-500 font-medium underline decoration-dotted underline-offset-2 mt-1"
                          >
                            soma das parcelas previstas
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>

                {/* Um bloco por cartão adicional do principal — a lista vem dos dados,
                    então adicionar/remover uma despesa adiciona/remove um bloco. */}
                {blocosPrincipal.map((bloco, i) => (
                  <React.Fragment key={bloco.responsavel}>
                    {i > 0 && <div className="border-t border-gray-100 my-2" />}
                    <BlocoFaturaPrincipal
                      bloco={bloco}
                      onComposicao={abrirComposicaoFatura}
                      onProjecao={abrirDetalhesProjecao}
                    />
                  </React.Fragment>
                ))}

                {/* Outros cartões — uma linha por cartão: uma despesa nova sobe o
                    total da linha em vez de criar uma linha nova. */}
                {(fatura.cartoesExtras.length > 0 || fatura.totaisPorResponsavel.length > 0) && (
                  <>
                    {fatura.cartoesExtras.length > 0 && (
                      <>
                        <div className="border-t border-gray-100 mt-4 mb-3" />
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Outros cartões</p>
                        <div className="space-y-2 mb-4">
                          {fatura.cartoesExtras.map((card) => (
                            <div key={card.tipo} className="flex items-center justify-between py-2.5 px-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${estiloResponsavel(card.responsavelDono).ponto}`} />
                                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{card.label}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 num shrink-0">
                                {fmt(card.atual)} <span className="font-normal text-gray-400">/ {card.previsto > 0 ? card.previsto.toLocaleString('pt-BR') : '–'}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {fatura.totaisPorResponsavel.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {fatura.totaisPorResponsavel.map((t) => {
                          const cor = estiloResponsavel(t.responsavel)
                          return (
                            <div key={t.responsavel} className={`${cor.tileFundo} rounded-2xl p-3`}>
                              <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${cor.ponto}`} />
                                <span className={`text-[11px] font-semibold truncate ${cor.tileTexto}`}>{t.responsavel} total</span>
                              </div>
                              <p className="text-xl font-bold text-gray-900 num">{fmt(t.atual)}</p>
                              <p className="text-[11px] text-gray-400 num mt-0.5">de {fmt(t.previsto)}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── 4. Insights com IA ── */}
          {isSameMonth(mesAtual, new Date()) && <DashboardInsights />}

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
                previsto={{ matheus: fatura.principalPrevistoPorResponsavel.Matheus ?? 0, jeniffer: fatura.principalPrevistoPorResponsavel.Jeniffer ?? 0, cartao1: fatura.cartao1Previsto, cartao2: fatura.cartao2Previsto }}
                dataFechamentoFatura={dataFechamentoNubank}
              />
            </div>

            <LimitesCategorias mesAtual={mesAtual} cartao1Nome={fatura.cartao1Nome} cartao2Nome={fatura.cartao2Nome} />

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
              <GraficoCategoriasDespesas mesAtual={mesAtual} ativo={aba === 'graficos'} />
            </div>

            <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
                  Projeção de Parcelamentos
                  <InfoPopover texto="Total de parcelas previstas para vencer nos próximos 6 meses, separado por pessoa e extras. Calculado a partir das compras parceladas já registradas no NuBank. Toque duas vezes em um ponto do gráfico para ver os detalhes do mês." />
                </h2>
              </div>
              <p className="text-xs text-gray-400 mb-4 ml-10">Próximos 6 meses · Toque duas vezes no mês para ver detalhes</p>
              <GraficoProjecao
                mesInicio={mesAtual}
                onPontoClicado={(serie, mes, valor, itens) => {
                  setDetalhesPonto({ serie, mes, valor, itens })
                  setDrawerAberto(true)
                }}
                ativo={aba === 'graficos'}
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
              <GraficoEvolucaoMensal mesAtual={mesAtual} ativo={aba === 'graficos'} />
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
              <GraficoEvolucaoInvestimentos mesAtual={mesAtual} ativo={aba === 'graficos'} />
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

      <ComposicaoFaturaModal
        aberto={composicaoAberta}
        onClose={() => setComposicaoAberta(false)}
        dados={composicaoDados}
        onVerCompras={verComprasDoTipo}
      />
    </div>
  )
}
