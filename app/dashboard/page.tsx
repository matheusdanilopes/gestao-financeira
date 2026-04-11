'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import GraficoProjecao from '@/components/GraficoProjecao'
import DrawerDetalhes from '@/components/DrawerDetalhes'

export default function Dashboard() {
  const [fatura, setFatura] = useState({ totalRealizado: 0, matheusAtual: 0, matheusPrevisto: 0, jenifferAtual: 0, jenifferPrevisto: 0, sobraMatheus: 0, sobraJeniffer: 0 })
  const [resumoCaixa, setResumoCaixa] = useState({ totalGastos: 0, sobraLiquida: 0, percentualComprometimento: 0 })
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [detalhesPonto, setDetalhesPonto] = useState<any>(null)

  useEffect(() => { carregarDados() }, [])

  async function carregarDados() {
    const hoje = new Date()
    const primeiroDia = startOfMonth(hoje)
    const ultimoDia = endOfMonth(hoje)
    const mesRef = format(primeiroDia, 'yyyy-MM-dd')

    const { data: transacoes } = await supabase.from('transacoes_nubank').select('valor, responsavel').gte('data', format(primeiroDia, 'yyyy-MM-dd')).lte('data', format(ultimoDia, 'yyyy-MM-dd'))
    const totalRealizado = transacoes?.reduce((acc, t) => acc + t.valor, 0) || 0
    const matheusAtual = transacoes?.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0) || 0
    const jenifferAtual = transacoes?.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0) || 0

    const { data: planejamento } = await supabase.from('planejamento').select('*').eq('mes_referencia', mesRef)
    const matheusPrevisto = planejamento?.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
    const jenifferPrevisto = (planejamento?.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) + (planejamento?.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)

    const receitaTotal = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
    const contasFixas = planejamento?.filter(p => p.categoria === 'Fixa').reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const debitosExtras = planejamento?.filter(p => p.categoria === 'Extra').reduce((acc, p) => acc + p.valor_previsto, 0) || 0
    const totalGastos = contasFixas + totalRealizado + debitosExtras
    const sobraLiquida = receitaTotal - totalGastos
    const percentualComprometimento = (totalGastos / receitaTotal) * 100

    setFatura({ totalRealizado, matheusAtual, matheusPrevisto, jenifferAtual, jenifferPrevisto, sobraMatheus: matheusPrevisto - matheusAtual, sobraJeniffer: jenifferPrevisto - jenifferAtual })
    setResumoCaixa({ totalGastos, sobraLiquida, percentualComprometimento: isNaN(percentualComprometimento) ? 0 : percentualComprometimento })
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <div className="sticky top-0 bg-gray-50 pt-2 pb-4 z-10"><h1 className="text-2xl font-bold">Dashboard Financeiro</h1><p className="text-sm text-gray-500">{format(new Date(), 'MMMM yyyy', { locale: ptBR })}</p></div>
      <div className="bg-white rounded-xl shadow p-4 mb-6"><h2 className="text-lg font-semibold mb-3">💳 Gestão de Fatura Nubank</h2><div className="text-2xl font-bold text-blue-600 mb-4">R$ {fatura.totalRealizado.toFixed(2)}</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 p-3 rounded-lg"><p className="font-medium">Matheus</p><p className="text-sm">Atual: R$ {fatura.matheusAtual.toFixed(2)}</p><p className="text-sm">Previsto: R$ {fatura.matheusPrevisto.toFixed(2)}</p><p className={`text-sm font-semibold ${fatura.sobraMatheus >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fatura.sobraMatheus >= 0 ? 'Sobra' : 'Excesso'}: R$ {Math.abs(fatura.sobraMatheus).toFixed(2)}</p></div>
          <div className="bg-gray-50 p-3 rounded-lg"><p className="font-medium">Jeniffer</p><p className="text-sm">Atual: R$ {fatura.jenifferAtual.toFixed(2)}</p><p className="text-sm">Previsto: R$ {fatura.jenifferPrevisto.toFixed(2)}</p><p className={`text-sm font-semibold ${fatura.sobraJeniffer >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fatura.sobraJeniffer >= 0 ? 'Sobra' : 'Excesso'}: R$ {Math.abs(fatura.sobraJeniffer).toFixed(2)}</p></div>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow p-4 mb-6"><h2 className="text-lg font-semibold mb-3">💰 Resumo de Caixa</h2><div className="space-y-2"><div className="flex justify-between"><span>Total de Gastos</span><span className="font-bold">R$ {resumoCaixa.totalGastos.toFixed(2)}</span></div><div className="flex justify-between"><span>Sobra Líquida</span><span className={`font-bold ${resumoCaixa.sobraLiquida >= 0 ? 'text-green-600' : 'text-red-600'}`}>R$ {resumoCaixa.sobraLiquida.toFixed(2)}</span></div><div className="flex justify-between"><span>Comprometimento da Renda</span><span className="font-bold">{resumoCaixa.percentualComprometimento.toFixed(1)}%</span></div></div></div>
      <div className="bg-white rounded-xl shadow p-4"><h2 className="text-lg font-semibold mb-3">📈 Projeção de Parcelamentos (6 meses)</h2><GraficoProjecao onPontoClicado={(serie, mes, valor, itens) => { setDetalhesPonto({ serie, mes, valor, itens }); setDrawerAberto(true) }} /></div>
      <DrawerDetalhes aberto={drawerAberto} onClose={() => setDrawerAberto(false)} dados={detalhesPonto} />
    </div>
  )
}
