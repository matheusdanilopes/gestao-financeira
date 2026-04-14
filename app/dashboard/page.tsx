'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
  extras: number
  totalGastos: number
  sobraLiquida: number
  percentualComprometimento: number
}

export default function Dashboard() {
  const [mesAtual, setMesAtual] = useState(new Date())
  const [fatura, setFatura] = useState<FaturaState>({
    totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0,
    jenifferAtual: 0, jenifferPrevisto: 0, sobraMatheus: 0, sobraJeniffer: 0,
    cartao1Items: [], cartao2Items: [],
  })
  const [resumoCaixa, setResumoCaixa] = useState<ResumoCaixaState>({
    receitaTotal: 0, contasFixas: 0, fatura: 0, faturaEhPrevisto: false, extras: 0,
    totalGastos: 0, sobraLiquida: 0, percentualComprometimento: 0,
  })
  const [investimentos, setInvestimentos] = useState<{ descricao: string; percentual: number }[]>([])
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<any>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { carregarDados(mesAtual) }, [mesAtual])

  async function carregarDados(mes: Date) {
    setCarregando(true)
    const primeiroDia = startOfMonth(mes)
    const mesRef = format(primeiroDia, 'yyyy-MM-dd')
    const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

    // Fatura considera sempre o mês selecionado + 1 (mês de cobrança do cartão).
    const { data: transacoesFatura } = await supabase
      .from('transacoes_nubank')
      .select('valor, responsavel')
      .eq('projeto_fatura', mesRefFatura)

    const totalRealizado = transacoesFatura?.reduce((acc, t) => acc + t.valor, 0) || 0
    const matheusAtual = transacoesFatura?.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0) || 0
    const jenifferAtual = transacoesFatura?.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0) || 0

    const { data: planejamento } = await supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', mesRef)

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

    // Se não há compras reais, usa o valor previsto de NuBank como estimativa
    const faturaEhPrevisto = totalRealizado === 0
    const faturaEfetiva = faturaEhPrevisto ? nuBankPrevisto : totalRealizado

    // Resumo: planejado total − nubank previsto + fatura efetiva
    const totalGastos = totalPlanejado - nuBankPrevisto + faturaEfetiva
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
      fatura: faturaEfetiva, faturaEhPrevisto, extras: 0,
      totalGastos, sobraLiquida, percentualComprometimento,
    })

    const { data: invData } = await supabase
      .from('investimentos')
      .select('descricao, percentual')
      .eq('mes_referencia', mesRef)
      .order('created_at', { ascending: true })
    setInvestimentos(invData || [])

    setCarregando(false)
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
            onClick={() => setMesAtual(prev => subMonths(prev, 1))}
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
            onClick={() => setMesAtual(prev => addMonths(prev, 1))}
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
                <p className="text-sm text-gray-600">
                  Atual: <span className="font-medium text-gray-800">R$ {fatura.matheusAtual.toFixed(2)}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Previsto: <span className="font-medium text-gray-800">R$ {fatura.matheusPrevisto.toFixed(2)}</span>
                </p>
                <p className={`text-sm font-bold mt-2 ${fatura.sobraMatheus >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fatura.sobraMatheus >= 0 ? '✓ Sobra' : '⚠ Excesso'}: R$ {Math.abs(fatura.sobraMatheus).toFixed(2)}
                </p>
              </div>
              <div className="bg-pink-50 border border-pink-100 p-3 rounded-lg">
                <p className="font-semibold text-pink-800 mb-2">Jeniffer</p>
                <p className="text-sm text-gray-600">
                  Atual: <span className="font-medium text-gray-800">R$ {fatura.jenifferAtual.toFixed(2)}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Previsto: <span className="font-medium text-gray-800">R$ {fatura.jenifferPrevisto.toFixed(2)}</span>
                </p>
                <p className={`text-sm font-bold mt-2 ${fatura.sobraJeniffer >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fatura.sobraJeniffer >= 0 ? '✓ Sobra' : '⚠ Excesso'}: R$ {Math.abs(fatura.sobraJeniffer).toFixed(2)}
                </p>
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
              </span>
              <span className="text-gray-700 font-medium">− R$ {resumoCaixa.fatura.toFixed(2)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="text-gray-600 font-medium">Total de Gastos</span>
              <span className="font-bold text-gray-800">R$ {resumoCaixa.totalGastos.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">Sobra Líquida</span>
              <span className={`font-bold text-lg ${resumoCaixa.sobraLiquida >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                R$ {resumoCaixa.sobraLiquida.toFixed(2)}
              </span>
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
            <div className="space-y-2">
              {investimentos.map((inv, i) => {
                const valor = resumoCaixa.sobraLiquida > 0
                  ? resumoCaixa.sobraLiquida * inv.percentual / 100
                  : 0
                return (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                      <span className="text-gray-700">{inv.descricao}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-violet-700">R$ {valor.toFixed(2)}</span>
                      <span className="text-gray-400 text-xs ml-1">({inv.percentual.toFixed(1)}%)</span>
                    </div>
                  </div>
                )
              })}
              {investimentos.length > 0 && (
                <div className="border-t pt-2 flex justify-between items-center text-sm">
                  <span className="text-gray-500 font-medium">Total</span>
                  <span className="font-bold text-violet-700">
                    R$ {(resumoCaixa.sobraLiquida > 0
                      ? resumoCaixa.sobraLiquida * investimentos.reduce((a, i) => a + i.percentual, 0) / 100
                      : 0).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Gráfico de Projeção de Parcelamentos */}
      <div className="bg-white rounded-xl shadow p-4">
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
