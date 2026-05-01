'use client'

import { useEffect } from 'react'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMes } from '@/components/MesProvider'
import GraficoProjecao from '@/components/GraficoProjecao'
import DrawerDetalhes from '@/components/DrawerDetalhes'
import BottomNav from '@/components/BottomNav'
import { PiggyBank } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'

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
}

export default function Dashboard() {
  const { mesAtual, setMesAtual } = useMes()
  const [fatura, setFatura] = useState<FaturaState>({
    totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0, matheusProjecaoParcelas: 0,
    jenifferAtual: 0, jenifferPrevisto: 0, jenifferProjecaoParcelas: 0,
    sobraMatheus: 0, sobraJeniffer: 0, cartao1Items: [], cartao2Items: [],
  })
  const [resumoCaixa, setResumoCaixa] = useState<ResumoCaixaState>({
    receitaTotal: 0, contasFixas: 0, fatura: 0, faturaEhPrevisto: false, extras: 0,
    totalGastos: 0, sobraLiquida: 0, saldoPrevisto: 0, percentualComprometimento: 0,
  })
  const [investimentos, setInvestimentos] = useState<{ id: string; descricao: string; percentual: number; aportado: number }[]>([])
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<any>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { carregarDados(mesAtual) }, [mesAtual])

  async function carregarDados(mes: Date) {
    setCarregando(true)
    try {
    const primeiroDia = startOfMonth(mes)
    const mesRef = format(primeiroDia, 'yyyy-MM-dd')
    const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

    const [
      { data: transacoesFatura },
      { data: planejamento },
      { data: invData },
      { data: transacoesCartoes },
    ] = await Promise.all([
      supabase
        .from('transacoes_nubank')
        .select('valor, responsavel')
        .eq('projeto_fatura', mesRefFatura)
        .eq('cartao', 'nubank'),
      supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, pago, valor_real')
        .eq('mes_referencia', mesRef),
      supabase
        .from('investimentos')
        .select('id, descricao, percentual')
        .eq('mes_referencia', mesRef)
        .order('created_at', { ascending: true }),
      supabase
        .from('transacoes_nubank')
        .select('valor, responsavel, cartao')
        .eq('projeto_fatura', mesRefFatura)
        .in('cartao', ['cartao1', 'cartao2']),
    ])

    const totalRealizado = transacoesFatura?.reduce((acc, t) => acc + t.valor, 0) || 0
    const matheusAtual = transacoesFatura?.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0) || 0
    const jenifferAtual = transacoesFatura?.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0) || 0

    const matheusPrevisto = planejamento?.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
    const jenifferPrevisto =
      (planejamento?.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) +
      (planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)


    const toCartaoItem = (p: any, prefixo: string): CartaoItem => ({
      nome: p.item.replace(prefixo, '').trim(),
      responsavel: p.responsavel || '',
      previsto: p.valor_previsto,
      pago: p.valor_real ?? p.valor_previsto,
    })

    const cartao1PlanejamentoItems: CartaoItem[] = (planejamento || [])
      .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))
      .map(p => toCartaoItem(p, '[CARTAO1]'))

    const cartao2PlanejamentoItems: CartaoItem[] = (planejamento || [])
      .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))
      .map(p => toCartaoItem(p, '[CARTAO2]'))

    // Totais importados via CSV para Cartão 1 e 2
    const cartao1TotalMatheus = (transacoesCartoes || [])
      .filter(t => t.cartao === 'cartao1' && t.responsavel === 'Matheus')
      .reduce((s, t) => s + t.valor, 0)
    const cartao1TotalJeniffer = (transacoesCartoes || [])
      .filter(t => t.cartao === 'cartao1' && t.responsavel === 'Jeniffer')
      .reduce((s, t) => s + t.valor, 0)
    const cartao2TotalMatheus = (transacoesCartoes || [])
      .filter(t => t.cartao === 'cartao2' && t.responsavel === 'Matheus')
      .reduce((s, t) => s + t.valor, 0)
    const cartao2TotalJeniffer = (transacoesCartoes || [])
      .filter(t => t.cartao === 'cartao2' && t.responsavel === 'Jeniffer')
      .reduce((s, t) => s + t.valor, 0)

    const cartao1ImportadoItems: CartaoItem[] = [
      ...(cartao1TotalMatheus > 0 ? [{ nome: 'Total importado', responsavel: 'Matheus', previsto: cartao1TotalMatheus, pago: cartao1TotalMatheus }] : []),
      ...(cartao1TotalJeniffer > 0 ? [{ nome: 'Total importado', responsavel: 'Jeniffer', previsto: cartao1TotalJeniffer, pago: cartao1TotalJeniffer }] : []),
    ]

    const cartao2ImportadoItems: CartaoItem[] = [
      ...(cartao2TotalMatheus > 0 ? [{ nome: 'Total importado', responsavel: 'Matheus', previsto: cartao2TotalMatheus, pago: cartao2TotalMatheus }] : []),
      ...(cartao2TotalJeniffer > 0 ? [{ nome: 'Total importado', responsavel: 'Jeniffer', previsto: cartao2TotalJeniffer, pago: cartao2TotalJeniffer }] : []),
    ]

    const cartao1Items: CartaoItem[] = [...cartao1PlanejamentoItems, ...cartao1ImportadoItems]
    const cartao2Items: CartaoItem[] = [...cartao2PlanejamentoItems, ...cartao2ImportadoItems]

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
      const { data: maxFaturaRow } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura')
        .eq('cartao', 'nubank')
        .order('projeto_fatura', { ascending: false })
        .limit(1)

      if (maxFaturaRow?.[0]?.projeto_fatura) {
        const { data: transacoesBase } = await supabase
          .from('transacoes_nubank')
          .select('projeto_fatura, descricao, valor, responsavel, parcela_atual, total_parcelas')
          .eq('projeto_fatura', maxFaturaRow[0].projeto_fatura)

        const mesProjecao = startOfMonth(addMonths(mes, 1))
        const contratos = new Map<string, { fatura: Date; atual: number; total: number; valor: number; responsavel: string }>()

        for (const t of (transacoesBase || [])) {
          let atual: number, total: number
          if (t.parcela_atual && t.total_parcelas) {
            atual = Number(t.parcela_atual)
            total = Number(t.total_parcelas)
          } else {
            const descricao = String(t.descricao || '')
            const matchParcela = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
            if (matchParcela) {
              atual = Number(matchParcela[1])
              total = Number(matchParcela[2])
            } else {
              const matchSlash = descricao.match(/\b(\d{1,2})\/(\d{1,2})\b/)
              if (!matchSlash) continue
              atual = Number(matchSlash[1])
              total = Number(matchSlash[2])
              if (total < 2) continue
            }
          }
          if (atual < 1 || total < atual) continue
          const descricao = String(t.descricao || '')
          const faturaDate = startOfMonth(new Date(t.projeto_fatura + 'T12:00:00'))
          const origem = subMonths(faturaDate, atual - 1)
          const descBase = descricao
            .replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '')
            .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '')
            .trim()
            .toLowerCase()
          const key = `${format(origem, 'yyyy-MM')}|${descBase}|${total}|${t.responsavel}`
          const existing = contratos.get(key)
          if (!existing || faturaDate > existing.fatura) {
            contratos.set(key, { fatura: faturaDate, atual, total, valor: t.valor, responsavel: t.responsavel })
          }
        }

        for (const { fatura: faturaDate, atual, total, valor, responsavel } of contratos.values()) {
          const deltaM =
            (mesProjecao.getFullYear() - faturaDate.getFullYear()) * 12 +
            (mesProjecao.getMonth() - faturaDate.getMonth())
          const parcelaNoMes = atual + deltaM
          if (parcelaNoMes >= 1 && parcelaNoMes <= total) {
            if (responsavel === 'Matheus') matheusProjecaoParcelas += valor
            else jenifferProjecaoParcelas += valor
          }
        }
      }
    }

    const faturaEfetiva = faturaEhPrevisto ? nuBankPrevisto : totalRealizado
    const saldoPrevisto = receitaTotal - totalPlanejado

    const NUBANK_ITEMS = new Set(['NuBank Matheus', 'NuBank Jeniffer', 'NuBank Jeniffer Conjunto'])
    const contasFixasAtual = (planejamento || [])
      .filter(p => {
        const item = typeof p.item === 'string' ? p.item : ''
        return !item.startsWith('[RECEITA]') && item !== 'Receita Total' && !NUBANK_ITEMS.has(item)
      })
      .reduce((acc, p) => acc + (p.pago ? (p.valor_real ?? p.valor_previsto) : p.valor_previsto), 0)

    const totalGastos = contasFixasAtual + faturaEfetiva
    const sobraLiquida = receitaTotal - totalGastos
    const percentualComprometimento = receitaTotal > 0 ? (totalGastos / receitaTotal) * 100 : 0

    setFatura({
      totalRealizado, matheusAtual, matheusPrevisto, matheusProjecaoParcelas,
      jenifferAtual, jenifferPrevisto, jenifferProjecaoParcelas,
      sobraMatheus: matheusPrevisto - matheusAtual - matheusProjecaoParcelas,
      sobraJeniffer: jenifferPrevisto - jenifferAtual - jenifferProjecaoParcelas,
      cartao1Items, cartao2Items,
    })
    setResumoCaixa({
      receitaTotal, contasFixas: totalPlanejado - nuBankPrevisto,
      fatura: faturaEfetiva, faturaEhPrevisto, extras: 0,
      totalGastos, sobraLiquida, saldoPrevisto, percentualComprometimento,
    })

    const ids = (invData || []).map(i => i.id)
    let aportadoMap: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: aportesData } = await supabase
        .from('investimentos_aportes')
        .select('investimento_id, valor')
        .in('investimento_id', ids)
      for (const a of (aportesData || [])) {
        aportadoMap[a.investimento_id] = (aportadoMap[a.investimento_id] || 0) + a.valor
      }
    }

    setInvestimentos((invData || []).map(i => ({ ...i, aportado: aportadoMap[i.id] || 0 })))

} catch (e) {
      console.error('Erro ao carregar dashboard:', e)
    } finally {
      setCarregando(false)
    }
  }

  const isMesAtual = format(mesAtual, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  const comprometimentoColor =
    resumoCaixa.percentualComprometimento > 90 ? 'text-red-600' :
    resumoCaixa.percentualComprometimento > 70 ? 'text-yellow-600' :
    'text-green-600'

  const comprometimentoBarColor =
    resumoCaixa.percentualComprometimento > 90
      ? 'bg-gradient-to-r from-red-500 to-red-600' :
    resumoCaixa.percentualComprometimento > 70
      ? 'bg-gradient-to-r from-yellow-400 to-yellow-500' :
    'bg-gradient-to-r from-green-500 to-emerald-500'

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      {/* Header + filtro de mês */}
      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-3">Dashboard Financeiro</h1>
        <div className="flex items-center justify-between bg-white rounded-2xl shadow-card px-2 py-1">
          <button
            onClick={() => setMesAtual(subMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="text-center flex-1">
            <p className="font-semibold capitalize text-gray-800">
              {format(mesAtual, 'MMMM yyyy', { locale: ptBR })}
            </p>
            {!isMesAtual && (
              <button
                onClick={() => setMesAtual(new Date())}
                className="text-xs text-primary-600 hover:underline"
              >
                Voltar ao mês atual
              </button>
            )}
          </div>
          <button
            onClick={() => setMesAtual(addMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
            aria-label="Próximo mês"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Gestão de Fatura Nubank */}
      <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          💳 Gestão de Fatura Nubank
          <InfoPopover texto="Visão consolidada da fatura NuBank por pessoa. 'Atual' é o valor já lançado no cartão. 'Previsto' é o limite planejado. 'Sobra' é o quanto resta antes de ultrapassar o orçamento. Os cards de 'Outros cartões' mostram o pago vs. previsto de cartões secundários (PicPay, etc.). O 'Resumo por pessoa' soma tudo: atual NuBank + parcelas projetadas + previsto dos demais cartões, indicando o total comprometido e quanto ainda resta do orçamento." />
        </h2>
        {carregando ? (
          <div className="animate-pulse space-y-3">
            <div className="h-9 bg-gray-200 rounded-xl w-2/5" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-28 bg-gray-200 rounded-2xl" />
              <div className="h-28 bg-gray-200 rounded-2xl" />
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="text-3xl font-bold text-primary-600">R$ {fatura.totalRealizado.toFixed(2)}</div>
              <p className="text-xs text-gray-400 mt-0.5">total atual na fatura NuBank</p>
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">NuBank</p>
            <div className="grid grid-cols-2 gap-3">
              {/* Matheus NuBank */}
              <div className="bg-blue-50 border border-blue-100 border-t-2 border-t-blue-400 p-3 rounded-2xl shadow-card">
                <p className="font-semibold text-blue-800 mb-2">Matheus</p>
                <div className="flex justify-between text-xs gap-1 text-gray-600">
                  <span>Atual</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.matheusAtual.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                  <span>Previsto</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.matheusPrevisto.toFixed(2)}</span>
                </div>
                {fatura.matheusProjecaoParcelas > 0 && (
                  <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                    <span>Parc. prev.</span>
                    <span className="font-medium text-orange-700 whitespace-nowrap">− R$ {fatura.matheusProjecaoParcelas.toFixed(2)}</span>
                  </div>
                )}
                <div className="mt-2 h-1 bg-blue-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${fatura.matheusPrevisto > 0 ? Math.min(100, (fatura.matheusAtual / fatura.matheusPrevisto) * 100) : 0}%` }} />
                </div>
                <div className={`flex justify-between text-xs font-bold mt-1.5 ${fatura.sobraMatheus >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span className="whitespace-nowrap">{fatura.sobraMatheus >= 0 ? '✓ Sobra' : '⚠ Excesso'}</span>
                  <span className="whitespace-nowrap">R$ {Math.abs(fatura.sobraMatheus).toFixed(2)}</span>
                </div>
              </div>

              {/* Jeniffer NuBank */}
              <div className="bg-pink-50 border border-pink-100 border-t-2 border-t-pink-400 p-3 rounded-2xl shadow-card">
                <p className="font-semibold text-pink-800 mb-2">Jeniffer</p>
                <div className="flex justify-between text-xs gap-1 text-gray-600">
                  <span>Atual</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.jenifferAtual.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                  <span>Previsto</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.jenifferPrevisto.toFixed(2)}</span>
                </div>
                {fatura.jenifferProjecaoParcelas > 0 && (
                  <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                    <span>Parc. prev.</span>
                    <span className="font-medium text-orange-700 whitespace-nowrap">− R$ {fatura.jenifferProjecaoParcelas.toFixed(2)}</span>
                  </div>
                )}
                <div className="mt-2 h-1 bg-pink-100 rounded-full overflow-hidden">
                  <div className="h-full bg-pink-400 rounded-full" style={{ width: `${fatura.jenifferPrevisto > 0 ? Math.min(100, (fatura.jenifferAtual / fatura.jenifferPrevisto) * 100) : 0}%` }} />
                </div>
                <div className={`flex justify-between text-xs font-bold mt-1.5 ${fatura.sobraJeniffer >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span className="whitespace-nowrap">{fatura.sobraJeniffer >= 0 ? '✓ Sobra' : '⚠ Excesso'}</span>
                  <span className="whitespace-nowrap">R$ {Math.abs(fatura.sobraJeniffer).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {(fatura.cartao1Items.length > 0 || fatura.cartao2Items.length > 0) && (
              <div className="opacity-60 mt-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Outros cartões</p>
                <div className="grid grid-cols-2 gap-2">
                  {[...fatura.cartao1Items, ...fatura.cartao2Items].map((item, i) => {
                    const isMatheus = item.responsavel === 'Matheus'
                    const bg = isMatheus ? 'bg-blue-50 border-blue-100' : 'bg-pink-50 border-pink-100'
                    const titleColor = isMatheus ? 'text-blue-800' : 'text-pink-800'
                    const barColor = isMatheus ? 'bg-blue-400' : 'bg-pink-400'
                    const barBg = isMatheus ? 'bg-blue-100' : 'bg-pink-100'
                    const sobra = item.previsto - item.pago
                    const pct = item.previsto > 0 ? Math.min(100, (item.pago / item.previsto) * 100) : 0
                    return (
                      <div key={i} className={`border p-2 rounded-2xl shadow-card ${bg}`}>
                        <p className={`font-semibold text-xs ${titleColor} mb-1`}>{item.nome}</p>
                        <div className="flex justify-between text-xs gap-1 text-gray-600">
                          <span>Atual</span>
                          <span className="font-medium text-gray-800 whitespace-nowrap">R$ {item.pago.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                          <span>Previsto</span>
                          <span className="font-medium text-gray-800 whitespace-nowrap">R$ {item.previsto.toFixed(2)}</span>
                        </div>
                        <div className={`mt-1.5 h-1 ${barBg} rounded-full overflow-hidden`}>
                          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <div className={`flex justify-between text-xs font-bold mt-1 ${sobra >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          <span className="whitespace-nowrap">{sobra >= 0 ? '✓ Sobra' : '⚠ Excesso'}</span>
                          <span className="whitespace-nowrap">R$ {Math.abs(sobra).toFixed(2)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {(() => {
                  const matheusTotalPrevisto = fatura.matheusPrevisto + fatura.cartao1Items.reduce((s, i) => s + i.previsto, 0)
                  const matheusTotalPago = fatura.matheusAtual + fatura.matheusProjecaoParcelas + fatura.cartao1Items.reduce((s, i) => s + i.previsto, 0)
                  const matheusRestante = matheusTotalPrevisto - matheusTotalPago
                  const matheusPct = matheusTotalPrevisto > 0 ? Math.min(100, (matheusTotalPago / matheusTotalPrevisto) * 100) : 0
                  const jenifferTotalPrevisto = fatura.jenifferPrevisto + fatura.cartao2Items.reduce((s, i) => s + i.previsto, 0)
                  const jenifferTotalPago = fatura.jenifferAtual + fatura.jenifferProjecaoParcelas + fatura.cartao2Items.reduce((s, i) => s + i.previsto, 0)
                  const jenifferRestante = jenifferTotalPrevisto - jenifferTotalPago
                  const jenifferPct = jenifferTotalPrevisto > 0 ? Math.min(100, (jenifferTotalPago / jenifferTotalPrevisto) * 100) : 0
                  return (
                    <>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-2 mb-1.5">Resumo por pessoa</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-blue-50 border border-blue-100 border-t-4 border-t-blue-500 p-2 rounded-2xl shadow-card">
                          <p className="font-bold text-xs text-blue-700 uppercase tracking-wide mb-1.5">Matheus</p>
                          <div className="flex justify-between text-xs gap-1 text-gray-600">
                            <span>Comprometido</span>
                            <span className="font-medium text-gray-800 whitespace-nowrap">R$ {matheusTotalPago.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                            <span>Previsto</span>
                            <span className="font-medium text-gray-800 whitespace-nowrap">R$ {matheusTotalPrevisto.toFixed(2)}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 bg-blue-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${matheusPct}%` }} />
                          </div>
                          <p className="text-right text-xs text-blue-400 mt-0.5">{matheusPct.toFixed(0)}% usado</p>
                          <div className={`flex justify-between text-xs font-bold mt-1 ${matheusRestante >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span className="whitespace-nowrap">{matheusRestante >= 0 ? '✓ Restante' : '⚠ Excesso'}</span>
                            <span className="whitespace-nowrap">R$ {Math.abs(matheusRestante).toFixed(2)}</span>
                          </div>
                        </div>
                        <div className="bg-pink-50 border border-pink-100 border-t-4 border-t-pink-500 p-2 rounded-2xl shadow-card">
                          <p className="font-bold text-xs text-pink-700 uppercase tracking-wide mb-1.5">Jeniffer</p>
                          <div className="flex justify-between text-xs gap-1 text-gray-600">
                            <span>Comprometido</span>
                            <span className="font-medium text-gray-800 whitespace-nowrap">R$ {jenifferTotalPago.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs gap-1 mt-0.5 text-gray-600">
                            <span>Previsto</span>
                            <span className="font-medium text-gray-800 whitespace-nowrap">R$ {jenifferTotalPrevisto.toFixed(2)}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 bg-pink-100 rounded-full overflow-hidden">
                            <div className="h-full bg-pink-500 rounded-full" style={{ width: `${jenifferPct}%` }} />
                          </div>
                          <p className="text-right text-xs text-pink-400 mt-0.5">{jenifferPct.toFixed(0)}% usado</p>
                          <div className={`flex justify-between text-xs font-bold mt-1 ${jenifferRestante >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span className="whitespace-nowrap">{jenifferRestante >= 0 ? '✓ Restante' : '⚠ Excesso'}</span>
                            <span className="whitespace-nowrap">R$ {Math.abs(jenifferRestante).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Resumo de Caixa */}
      <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          💰 Resumo de Caixa
          <InfoPopover texto="Visão geral das finanças do mês. O 'Saldo Previsto' considera apenas os valores planejados. O 'Saldo Atual' usa a fatura real do NuBank quando disponível, ou a estimada por parcelas. O comprometimento indica qual percentual da renda já está comprometido com gastos." />
        </h2>
        {carregando ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-gray-200 rounded-xl w-full" />
            <div className="h-6 bg-gray-200 rounded-xl w-full" />
            <div className="h-6 bg-gray-200 rounded-xl w-full" />
            <div className="h-3 bg-gray-200 rounded-full w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Receita prevista</span>
              <span className="text-green-700 font-medium">R$ {resumoCaixa.receitaTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Despesas planejadas</span>
              <span className="text-gray-700 font-medium">− R$ {resumoCaixa.contasFixas.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">
                Fatura NuBank (mês+1)
                {resumoCaixa.faturaEhPrevisto && (
                  <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">previsto</span>
                )}
              </span>
              <span className="text-gray-700 font-medium">− R$ {resumoCaixa.fatura.toFixed(2)}</span>
            </div>
            <div className="border-t pt-2 grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center py-2 px-3 rounded-2xl bg-gray-50 border border-gray-100 shadow-card">
                <span className="text-xs text-gray-500 mb-1">Saldo Previsto</span>
                <span className={`text-base font-bold ${resumoCaixa.saldoPrevisto >= 0 ? 'text-primary-600' : 'text-red-600'}`}>
                  R$ {resumoCaixa.saldoPrevisto.toFixed(2)}
                </span>
                <span className="text-[10px] text-gray-400 mt-0.5">só previsões</span>
              </div>
              <div className="flex flex-col items-center py-2 px-3 rounded-2xl bg-primary-50 border border-primary-100 shadow-card">
                <span className="text-xs text-primary-600 mb-1">Saldo Atual</span>
                <span className={`text-base font-bold ${resumoCaixa.sobraLiquida >= 0 ? 'text-primary-700' : 'text-red-600'}`}>
                  R$ {resumoCaixa.sobraLiquida.toFixed(2)}
                </span>
                <span className="text-[10px] text-primary-400 mt-0.5">
                  {resumoCaixa.faturaEhPrevisto ? 'fatura estimada' : 'fatura real'}
                </span>
              </div>
            </div>
            <div className="pt-1">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs text-gray-500">Comprometimento da renda</span>
                <span className={`text-sm font-bold ${comprometimentoColor}`}>
                  {resumoCaixa.percentualComprometimento.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all duration-700 ${comprometimentoBarColor}`}
                  style={{ width: `${Math.min(resumoCaixa.percentualComprometimento, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-gray-400">0%</span>
                <span className="text-xs text-yellow-500">70%</span>
                <span className="text-xs text-red-400">90%</span>
                <span className="text-xs text-gray-400">100%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Investimentos */}
      {(carregando || investimentos.length > 0) && (
        <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PiggyBank className="w-5 h-5 text-violet-600" />
              <h2 className="text-lg font-semibold flex items-center gap-1.5">
                Investimentos
                <InfoPopover texto="Progresso dos aportes mensais em cada investimento. A meta de cada item é calculada como um percentual da sobra líquida do mês. Quando o aporte atinge a meta, o indicador fica verde." />
              </h2>
            </div>
            <a href="/investimentos" className="text-xs text-violet-600 hover:underline">Ver tudo</a>
          </div>
          {carregando ? (
            <div className="animate-pulse space-y-2">
              <div className="h-5 bg-gray-200 rounded-xl w-3/4" />
              <div className="h-5 bg-gray-200 rounded-xl w-1/2" />
            </div>
          ) : (
            <div className="space-y-3">
              {investimentos.map((inv) => {
                const meta = resumoCaixa.sobraLiquida > 0 ? resumoCaixa.sobraLiquida * inv.percentual / 100 : 0
                const progresso = meta > 0 ? Math.min((inv.aportado / meta) * 100, 100) : 0
                const concluido = meta > 0 && inv.aportado >= meta
                return (
                  <div key={inv.id}>
                    <div className="flex justify-between items-center text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${concluido ? 'bg-green-500' : 'bg-violet-400'}`} />
                        <span className="text-gray-700">{inv.descricao}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-semibold ${concluido ? 'text-green-600' : 'text-violet-700'}`}>
                          R$ {inv.aportado.toFixed(2)}
                        </span>
                        <span className="text-gray-400 text-xs ml-1">/ R$ {meta.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-500 ${concluido ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-violet-400 to-violet-600'}`}
                        style={{ width: `${progresso}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              {investimentos.length > 0 && (
                <div className="border-t pt-2 flex justify-between items-center text-sm">
                  <span className="text-gray-500 font-medium">Total aportado</span>
                  <span className="font-bold text-violet-700">
                    R$ {investimentos.reduce((a, i) => a + i.aportado, 0).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Gráfico de Projeção de Parcelamentos */}
      <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-1.5">
          📈 Projeção de Parcelamentos
          <InfoPopover texto="Previsão do total de parcelas que vencerão nos próximos 6 meses, separado por pessoa (Matheus, Jeniffer) e extras. Calculado com base nas transações parceladas já registradas no NuBank. Toque em um ponto do gráfico para ver os detalhes." />
        </h2>
        <p className="text-xs text-gray-400 mb-3">Próximos 6 meses · Toque em um ponto para ver detalhes</p>
        <GraficoProjecao
          mesInicio={mesAtual}
          onPontoClicado={(serie, mes, valor, itens) => {
            setDetalhesPonto({ serie, mes, valor, itens })
            setDrawerAberto(true)
          }}
        />
      </div>

      <DrawerDetalhes aberto={drawerAberto} onClose={() => setDrawerAberto(false)} dados={detalhesPonto} />
      <BottomNav />
    </div>
  )
}
