'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileDown, FileSpreadsheet, TrendingUp, Receipt, ShoppingCart, PiggyBank, FileBarChart } from 'lucide-react'
import MonthSelector from '@/components/MonthSelector'
import EmptyState from '@/components/EmptyState'
import { useMes } from '@/components/MesProvider'
import { buscarRelatorioMensal, RELATORIO_EXPLICACOES, type RelatorioMensal } from '@/lib/relatorioMensal'
import { formatBRL } from '@/lib/logger'

function RelatorioSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
          <div className="h-4 bg-gray-100 rounded-full w-32" />
          <div className="h-3 bg-gray-100 rounded-full w-full" />
          <div className="h-16 bg-gray-100 rounded-2xl" />
        </div>
      ))}
    </div>
  )
}

interface SecaoProps {
  titulo: string
  explicacao: string
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  corIcone: string
  corFundo: string
  total: number
  colunas: string[]
  linhas: (string | number)[][]
}

function SecaoRelatorio({ titulo, explicacao, Icon, corIcone, corFundo, total, colunas, linhas }: SecaoProps) {
  return (
    <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl ${corFundo} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${corIcone}`} strokeWidth={1.8} />
        </div>
        <h2 className="font-bold text-gray-900">{titulo}</h2>
      </div>
      <p className="text-xs text-gray-500 italic leading-snug">{explicacao}</p>

      {linhas.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">Nenhum lançamento neste mês.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="text-gray-400 text-left">
                {colunas.map(c => (
                  <th key={c} className="font-semibold py-1.5 px-1 whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha, idx) => (
                <tr key={idx} className="border-t border-gray-50">
                  {linha.map((valor, colIdx) => (
                    <td key={colIdx} className="py-1.5 px-1 text-gray-700 whitespace-nowrap">{valor}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        <span className="text-xs font-semibold text-gray-500">Total {titulo}</span>
        <span className="font-bold text-gray-900">{formatBRL(total)}</span>
      </div>
    </div>
  )
}

function RelatorioConteudo({ relatorio }: { relatorio: RelatorioMensal }) {
  return (
    <div className="space-y-3">
      <SecaoRelatorio
        titulo="Receitas"
        explicacao={RELATORIO_EXPLICACOES.receitas}
        Icon={TrendingUp}
        corIcone="text-green-600"
        corFundo="bg-green-50"
        total={relatorio.receitas.total}
        colunas={['Item', 'Responsável', 'Valor']}
        linhas={relatorio.receitas.itens.map(i => [i.item, i.responsavel, formatBRL(i.valor)])}
      />

      <SecaoRelatorio
        titulo="Despesas"
        explicacao={RELATORIO_EXPLICACOES.despesas}
        Icon={Receipt}
        corIcone="text-red-500"
        corFundo="bg-red-50"
        total={relatorio.despesas.total}
        colunas={['Item', 'Categoria', 'Status', 'Valor']}
        linhas={relatorio.despesas.itens.map(i => [i.item, i.categoria, i.status, formatBRL(i.valor)])}
      />

      <SecaoRelatorio
        titulo="Compras"
        explicacao={RELATORIO_EXPLICACOES.compras}
        Icon={ShoppingCart}
        corIcone="text-orange-500"
        corFundo="bg-orange-50"
        total={relatorio.compras.total}
        colunas={['Data', 'Descrição', 'Responsável', 'Categoria', 'Valor']}
        linhas={relatorio.compras.itens.map(i => [i.data, i.descricao, i.responsavel, i.categoria ?? '', formatBRL(i.valor)])}
      />

      <SecaoRelatorio
        titulo="Investimentos"
        explicacao={RELATORIO_EXPLICACOES.investimentos}
        Icon={PiggyBank}
        corIcone="text-blue-600"
        corFundo="bg-blue-50"
        total={relatorio.investimentos.total}
        colunas={['Data', 'Descrição', 'Observação', 'Valor']}
        linhas={relatorio.investimentos.itens.map(i => [i.data, i.descricao, i.observacao ?? '', formatBRL(i.valor)])}
      />

      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-2">
        <h2 className="font-bold text-gray-900">Resumo</h2>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Saldo do mês (valores realizados)</span>
          <span className={`font-bold ${relatorio.saldoMes >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {formatBRL(relatorio.saldoMes)}
          </span>
        </div>
        <p className="text-xs text-gray-400 leading-snug">
          Compras já estão refletidas na fatura do cartão em Despesas. Investimentos representam valores destinados a partir do saldo do mês.
        </p>
      </div>
    </div>
  )
}

function RelatoriosContent() {
  const { mesAtual, setMesAtual } = useMes()
  const [relatorio, setRelatorio] = useState<RelatorioMensal | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(async () => {
    setStatus('loading')
    try {
      const dados = await buscarRelatorioMensal(mesAtual)
      setRelatorio(dados)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [mesAtual])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function handleBaixarPdf() {
    if (!relatorio || gerando) return
    setGerando(true)
    try {
      const { gerarRelatorioPdf } = await import('@/lib/gerarRelatorioPdf')
      await gerarRelatorioPdf(relatorio, mesAtual)
    } finally {
      setGerando(false)
    }
  }

  async function handleBaixarCsv() {
    if (!relatorio || gerando) return
    setGerando(true)
    try {
      const { gerarRelatorioCsv } = await import('@/lib/gerarRelatorioCsv')
      gerarRelatorioCsv(relatorio, mesAtual)
    } finally {
      setGerando(false)
    }
  }

  const desabilitado = status !== 'ready' || gerando

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <h1 className="text-xl font-bold text-gray-900 mb-3">Relatórios</h1>
        <MonthSelector value={mesAtual} onChange={setMesAtual} />
      </div>

      <div className="page-content space-y-3">
        {status === 'loading' && <RelatorioSkeleton />}

        {status === 'error' && (
          <div className="bg-white rounded-3xl shadow-card border border-gray-100">
            <EmptyState
              icon={FileBarChart}
              title="Não foi possível carregar o relatório"
              description="Verifique sua conexão e tente novamente."
              action={
                <button
                  onClick={carregar}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors"
                >
                  Tentar novamente
                </button>
              }
            />
          </div>
        )}

        {status === 'ready' && relatorio && <RelatorioConteudo relatorio={relatorio} />}

        <div className="flex gap-2.5 pt-1">
          <button
            onClick={handleBaixarPdf}
            disabled={desabilitado}
            className="flex-1 py-3 rounded-2xl font-semibold text-sm
                       flex items-center justify-center gap-2
                       transition-all duration-150 ease-spring
                       shadow-sm hover:shadow-card-md
                       active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400
                       bg-red-600 text-white hover:bg-red-700"
          >
            <FileDown className="w-4 h-4 shrink-0" />
            Baixar PDF
          </button>
          <button
            onClick={handleBaixarCsv}
            disabled={desabilitado}
            className="flex-1 py-3 rounded-2xl font-semibold text-sm
                       flex items-center justify-center gap-2
                       transition-all duration-150 ease-spring
                       shadow-sm hover:shadow-card-md
                       active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-400
                       bg-green-600 text-white hover:bg-green-700"
          >
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            Baixar CSV
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RelatoriosPage() {
  return <RelatoriosContent />
}
