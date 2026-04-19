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
  jenifferAtual: number
  jenifferPrevisto: number
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
  projecaoParcelas: number
  extras: number
  totalGastos: number
  sobraLiquida: number
  saldoPrevisto: number
  percentualComprometimento: number
}

export default function Dashboard() {
  const { mesAtual, setMesAtual } = useMes()
  const [fatura, setFatura] = useState<FaturaState>({
    totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0,
    jenifferAtual: 0, jenifferPrevisto: 0, sobraMatheus: 0, sobraJeniffer: 0,
    cartao1Items: [], cartao2Items: [],
  })
  const [resumoCaixa, setResumoCaixa] = useState<ResumoCaixaState>({
    receitaTotal: 0, contasFixas: 0, fatura: 0, faturaEhPrevisto: false, projecaoParcelas: 0,
    extras: 0, totalGastos: 0, sobraLiquida: 0, saldoPrevisto: 0, percentualComprometimento: 0,
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
    ] = await Promise.all([
      supabase
        .from('transacoes_nubank')
        .select('valor, responsavel')
        .eq('projeto_fatura', mesRefFatura),
      supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, pago, valor_real')
        .eq('mes_referencia', mesRef),
      supabase
        .from('investimentos')
        .select('id, descricao, percentual')
        .eq('mes_referencia', mesRef)
        .order('created_at', { ascending: true }),
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
      pago: p.pago ? (p.valor_real ?? p.valor_previsto) : 0,
    })

    const cartao1Items: CartaoItem[] = (planejamento || [])
      .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))
      .map(p => toCartaoItem(p, '[CARTAO1]'))

    const cartao2Items: CartaoItem[] = (planejamento || [])
      .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))
      .map(p => toCartaoItem(p, '[CARTAO2]'))

    const receitaBase = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
    const receitasExtras = planejamento
      ?.filter(p => typeof p.item === 'string' && p.item.startsWith('[RECEITA]'))
      .reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const receitaTotal = receitaBase + receitasExtras

    // Total de todas as despesas previstas (exclui itens de receita)
    const totalPlanejado = (planejamento || [])
      .filter(p => {
        const item = typeof p.item === 'string' ? p.item : ''
        return !item.startsWith('[RECEITA]') && item !== 'Receita Total'
      })
      .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

    const nuBankPrevisto = matheusPrevisto + jenifferPrevisto

    // Se não há compras reais, usa o valor previsto + projeção de parcelas como estimativa
    const faturaEhPrevisto = totalRealizado === 0
    let projecaoParcelas = 0
    if (faturaEhPrevisto) {
      const { data: maxFaturaRow } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura')
        .order('projeto_fatura', { ascending: false })
        .limit(1)

      if (maxFaturaRow?.[0]?.projeto_fatura) {
        const { data: transacoesBase } = await supabase
          .from('transacoes_nubank')
          .select('projeto_fatura, descricao, valor, responsavel, parcela_atual, total_parcelas')
          .eq('projeto_fatura', maxFaturaRow[0].projeto_fatura)

        const mesProjecao = startOfMonth(addMonths(mes, 1))
        const contratos = new Map<string, { fatura: Date; atual: number; total: number; valor: number }>()

        for (const t of (transacoesBase || [])) {
          const descricao = String(t.descricao || '')
          if (!/parcela/i.test(descricao)) continue
          let atual: number, total: number
          if (t.parcela_atual && t.total_parcelas) {
            atual = Number(t.parcela_atual)
            total = Number(t.total_parcelas)
          } else {
            const match = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
            if (!match) continue
            atual = Number(match[1])
            total = Number(match[2])
          }
          if (atual < 1 || total < atual) continue
          const fatura = startOfMonth(new Date(t.projeto_fatura))
          const origem = subMonths(fatura, atual - 1)
          const descBase = descricao.replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '').trim().toLowerCase()
          const key = `${format(origem, 'yyyy-MM')}|${descBase}|${total}|${t.responsavel}`
          const existing = contratos.get(key)
          if (!existing || fatura > existing.fatura) {
            contratos.set(key, { fatura, atual, total, valor: t.valor })
          }
        }

        for (const { fatura, atual, total, valor } of contratos.values()) {
          const deltaM =
            (mesProjecao.getFullYear() - fatura.getFullYear()) * 12 +
            (mesProjecao.getMonth() - fatura.getMonth())
          const parcelaNoMes = atual + deltaM
          if (parcelaNoMes >= 1 && parcelaNoMes <= total) {
            projecaoParcelas += valor
          }
        }
      }
    }
    const faturaEfetiva = faturaEhPrevisto ? nuBankPrevisto + projecaoParcelas : totalRealizado

    // Saldo Previsto: usa apenas valores planejados (nuBankPrevisto sempre)
    const saldoPrevisto = receitaTotal - totalPlanejado

    // Saldo Atual: usa valor_real quando pago=true (igual à lógica da fatura)
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
      totalRealizado, matheusAtual, matheusPrevisto,
      jenifferAtual, jenifferPrevisto,
      sobraMatheus: matheusPrevisto - matheusAtual,
      sobraJeniffer: jenifferPrevisto - jenifferAtual,
      cartao1Items, cartao2Items,
    })
    setResumoCaixa({
      receitaTotal, contasFixas: totalPlanejado - nuBankPrevisto,
      fatura: faturaEfetiva, faturaEhPrevisto, projecaoParcelas,
      extras: 0, totalGastos, sobraLiquida, saldoPrevisto, percentualComprometimento,
    })

    // Batch 2: aportes depende dos IDs de investimentos
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
    resumoCaixa.percentualComprometimento > 90 ? 'bg-red-500' :
    resumoCaixa.percentualComprometimento > 70 ? 'bg-yellow-500' :
    'bg-green-500'

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">

      {/* Header + filtro de mês */}
      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-3">Dashboard Financeiro</h1>
        <div className="flex items-center justify-between bg-white rounded-xl shadow-sm px-2 py-1">
          <button
            onClick={() => setMesAtual(subMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
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
                className="text-xs text-blue-500 hover:underline"
              >
                Voltar ao mês atual
              </button>
            )}
          </div>
          <button
            onClick={() => setMesAtual(addMonths(mesAtual, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Próximo mês"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Gestão de Fatura Nubank */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3">💳 Gestão de Fatura Nubank</h2>
        {carregando ? (
          <div className="animate-pulse space-y-3">
            <div className="h-9 bg-gray-200 rounded w-2/5" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-28 bg-gray-200 rounded-lg" />
              <div className="h-28 bg-gray-200 rounded-lg" />
            </div>
          </div>
        ) : (
          <>
            <div className="text-3xl font-bold text-blue-600 mb-4">
              R$ {fatura.totalRealizado.toFixed(2)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg">
                <p className="font-semibold text-blue-800 mb-2">Matheus</p>
                <div className="flex justify-between text-sm gap-1">
                  <span className="text-gray-600">Atual</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.matheusAtual.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm gap-1 mt-0.5">
                  <span className="text-gray-600">Previsto</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.matheusPrevisto.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between text-sm font-bold mt-2 ${fatura.sobraMatheus >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span>{fatura.sobraMatheus >= 0 ? '✓ Sobra' : '⚠ Excesso'}</span>
                  <span className="whitespace-nowrap">R$ {Math.abs(fatura.sobraMatheus).toFixed(2)}</span>
                </div>
              </div>
              <div className="bg-pink-50 border border-pink-100 p-3 rounded-lg">
                <p className="font-semibold text-pink-800 mb-2">Jeniffer</p>
                <div className="flex justify-between text-sm gap-1">
                  <span className="text-gray-600">Atual</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.jenifferAtual.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm gap-1 mt-0.5">
                  <span className="text-gray-600">Previsto</span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">R$ {fatura.jenifferPrevisto.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between text-sm font-bold mt-2 ${fatura.sobraJeniffer >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span>{fatura.sobraJeniffer >= 0 ? '✓ Sobra' : '⚠ Excesso'}</span>
                  <span className="whitespace-nowrap">R$ {Math.abs(fatura.sobraJeniffer).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {(fatura.cartao1Items.length > 0 || fatura.cartao2Items.length > 0) && (
              <div className="mt-3 space-y-2">
                {[...fatura.cartao1Items, ...fatura.cartao2Items].map((item, i) => {
                  const isMatheus = item.responsavel === 'Matheus'
                  const bg = isMatheus ? 'bg-blue-50 border-blue-100' : 'bg-pink-50 border-pink-100'
                  const titleColor = isMatheus ? 'text-blue-800' : 'text-pink-800'
                  const sobra = item.previsto - item.pago
                  return (
                    <div key={i} className={`border p-3 rounded-lg ${bg}`}>
                      <p className={`font-semibold text-sm ${titleColor} mb-1`}>{item.nome}</p>
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Pago: <span className="font-medium text-gray-800">R$ {item.pago.toFixed(2)}</span></span>
                        <span>Previsto: <span className="font-medium text-gray-800">R$ {item.previsto.toFixed(2)}</span></span>
                      </div>
                      {item.pago > 0 && (
                        <p className={`text-xs font-bold mt-1 ${sobra >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {sobra >= 0 ? '✓ Sobra' : '⚠ Excesso'}: R$ {Math.abs(sobra).toFixed(2)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Resumo de Caixa */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3">💰 Resumo de Caixa</h2>
        {carregando ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-gray-200 rounded w-full" />
            <div className="h-6 bg-gray-200 rounded w-full" />
            <div className="h-6 bg-gray-200 rounded w-full" />
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
                {resumoCaixa.faturaEhPrevisto && resumoCaixa.projecaoParcelas > 0 && (
                  <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                    +R${resumoCaixa.projecaoParcelas.toFixed(0)} parcelas
                  </span>
                )}
              </span>
              <span className="text-gray-700 font-medium">− R$ {resumoCaixa.fatura.toFixed(2)}</span>
            </div>
            <div className="border-t pt-2 grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center py-2 px-3 rounded-lg bg-gray-50 border border-gray-100">
                <span className="text-xs text-gray-500 mb-1">Saldo Previsto</span>
                <span className={`text-base font-bold ${resumoCaixa.saldoPrevisto >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  R$ {resumoCaixa.saldoPrevisto.toFixed(2)}
                </span>
                <span className="text-[10px] text-gray-400 mt-0.5">só previsões</span>
              </div>
              <div className="flex flex-col items-center py-2 px-3 rounded-lg bg-blue-50 border border-blue-100">
                <span className="text-xs text-blue-600 mb-1">Saldo Atual</span>
                <span className={`text-base font-bold ${resumoCaixa.sobraLiquida >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                  R$ {resumoCaixa.sobraLiquida.toFixed(2)}
                </span>
                <span className="text-[10px] text-blue-400 mt-0.5">
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
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PiggyBank className="w-5 h-5 text-violet-600" />
              <h2 className="text-lg font-semibold">Investimentos</h2>
            </div>
            <a href="/investimentos" className="text-xs text-violet-600 hover:underline">Ver tudo</a>
          </div>
          {carregando ? (
            <div className="animate-pulse space-y-2">
              <div className="h-5 bg-gray-200 rounded w-3/4" />
              <div className="h-5 bg-gray-200 rounded w-1/2" />
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
                        className={`h-1.5 rounded-full transition-all duration-500 ${concluido ? 'bg-green-500' : 'bg-violet-400'}`}
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
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <h2 className="text-lg font-semibold">📈 Projeção de Parcelamentos</h2>
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
