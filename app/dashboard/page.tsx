'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import GraficoProjecao from '@/components/GraficoProjecao'
import DrawerDetalhes from '@/components/DrawerDetalhes'
import BottomNav from '@/components/BottomNav'

interface FaturaState {
  totalRealizado: number
  matheusAtual: number
  matheusPrevisto: number
  jenifferAtual: number
  jenifferPrevisto: number
  sobraMatheus: number
  sobraJeniffer: number
}

interface ResumoCaixaState {
  totalGastos: number
  sobraLiquida: number
  percentualComprometimento: number
}

export default function Dashboard() {
  const [mesAtual, setMesAtual] = useState(new Date())
  const [fatura, setFatura] = useState<FaturaState>({
    totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0,
    jenifferAtual: 0, jenifferPrevisto: 0, sobraMatheus: 0, sobraJeniffer: 0,
  })
  const [resumoCaixa, setResumoCaixa] = useState<ResumoCaixaState>({
    totalGastos: 0, sobraLiquida: 0, percentualComprometimento: 0,
  })
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

    // Resumo de caixa segue o mês selecionado normalmente.
    const { data: transacoesResumo } = await supabase
      .from('transacoes_nubank')
      .select('valor')
      .eq('projeto_fatura', mesRef)

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

    const receitaBase = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
    const receitasExtras = planejamento
      ?.filter(p => typeof p.item === 'string' && p.item.startsWith('[RECEITA]'))
      .reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const receitaTotal = receitaBase + receitasExtras
    // Exclui itens NuBank do fixo pois o gasto real já está em totalRealizado
    const contasFixas = planejamento
      ?.filter(p => p.categoria === 'Fixa' && !p.item.toLowerCase().startsWith('nubank'))
      .reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const debitosExtras = planejamento
      ?.filter(p => p.categoria === 'Extra' && !(typeof p.item === 'string' && p.item.startsWith('[RECEITA]')))
      .reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const totalRealizadoResumo = transacoesResumo?.reduce((acc, t) => acc + t.valor, 0) || 0
    const totalGastos = contasFixas + totalRealizadoResumo + debitosExtras
    const sobraLiquida = receitaTotal - totalGastos
    const percentualComprometimento = receitaTotal > 0 ? (totalGastos / receitaTotal) * 100 : 0

    setFatura({
      totalRealizado, matheusAtual, matheusPrevisto,
      jenifferAtual, jenifferPrevisto,
      sobraMatheus: matheusPrevisto - matheusAtual,
      sobraJeniffer: jenifferPrevisto - jenifferAtual,
    })
    setResumoCaixa({ totalGastos, sobraLiquida, percentualComprometimento })
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
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Total de Gastos</span>
              <span className="font-bold text-gray-800">R$ {resumoCaixa.totalGastos.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Sobra Líquida</span>
              <span className={`font-bold ${resumoCaixa.sobraLiquida >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                R$ {resumoCaixa.sobraLiquida.toFixed(2)}
              </span>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Comprometimento da Renda</span>
                <span className={`font-bold ${comprometimentoColor}`}>
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

      {/* Gráfico de Projeção de Parcelamentos */}
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold">📈 Projeção de Parcelamentos</h2>
        <p className="text-xs text-gray-400 mb-3">Próximos 6 meses · Toque em um ponto para ver detalhes</p>
        <GraficoProjecao
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
