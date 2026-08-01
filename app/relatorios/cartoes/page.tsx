'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, FileDown, FileSpreadsheet, History, TrendingUp, Layers, CreditCard, AlertTriangle } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import { buscarRelatorioCartoes, RELATORIO_CARTOES_EXPLICACOES, type RelatorioCartoes, type MesGasto } from '@/lib/relatorioCartoes'
import { formatBRL } from '@/lib/logger'

const ORIGEM_LABEL: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
  planejamento: 'Planejado',
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatarMes(mes: Date): string {
  return capitalizar(format(mes, 'MMM/yyyy', { locale: ptBR }))
}

function RelatorioSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-3">
          <div className="h-4 bg-gray-100 rounded-full w-32" />
          <div className="h-3 bg-gray-100 rounded-full w-full" />
          <div className="h-16 bg-gray-100 rounded-2xl" />
        </div>
      ))}
    </div>
  )
}

interface Totalizador {
  label: string
  valor: number
}

interface SecaoProps {
  titulo: string
  explicacao: string
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  corIcone: string
  corFundo: string
  totais: Totalizador[]
  colunas: string[]
  linhas: (string | number)[][]
}

function SecaoRelatorio({ titulo, explicacao, Icon, corIcone, corFundo, totais, colunas, linhas }: SecaoProps) {
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
        <p className="text-xs text-gray-400 py-2">Nenhum dado neste período.</p>
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

      <div className="flex justify-between items-center pt-2 border-t border-gray-100 flex-wrap gap-x-4 gap-y-1">
        {totais.map(t => (
          <div key={t.label} className="flex items-baseline gap-1.5">
            <span className="text-xs font-semibold text-gray-500">{t.label}</span>
            <span className="font-bold text-gray-900">{formatBRL(t.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function linhasMesGasto(meses: MesGasto[]): (string | number)[][] {
  return meses.map(m => [formatarMes(m.mes), formatBRL(m.total), formatBRL(m.matheus), formatBRL(m.jeniffer), formatBRL(m.conjunto)])
}

function somaTotal(meses: MesGasto[]): number {
  return meses.reduce((acc, m) => acc + m.total, 0)
}

function RelatorioConteudo({ relatorio }: { relatorio: RelatorioCartoes }) {
  const totalRestante = relatorio.parcelamentosAbertos.reduce((acc, p) => acc + p.valorRestante, 0)

  return (
    <div className="space-y-3">
      {relatorio.erros.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2} />
          <div className="space-y-0.5">
            {relatorio.erros.map((erro, idx) => (
              <p key={idx} className="text-xs text-amber-700">{erro}</p>
            ))}
          </div>
        </div>
      )}

      <SecaoRelatorio
        titulo="Histórico de Gastos (12 meses)"
        explicacao={RELATORIO_CARTOES_EXPLICACOES.historico}
        Icon={History}
        corIcone="text-orange-500"
        corFundo="bg-orange-50"
        totais={[{ label: 'Total 12 meses', valor: somaTotal(relatorio.historico) }]}
        colunas={['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto']}
        linhas={linhasMesGasto(relatorio.historico)}
      />

      <SecaoRelatorio
        titulo="Projeção de Parcelamentos (12 meses)"
        explicacao={RELATORIO_CARTOES_EXPLICACOES.projecao}
        Icon={TrendingUp}
        corIcone="text-violet-600"
        corFundo="bg-violet-50"
        totais={[{ label: 'Total projetado', valor: somaTotal(relatorio.projecao) }]}
        colunas={['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto']}
        linhas={linhasMesGasto(relatorio.projecao)}
      />

      <SecaoRelatorio
        titulo="Parcelamentos em Aberto"
        explicacao={RELATORIO_CARTOES_EXPLICACOES.parcelamentosAbertos}
        Icon={Layers}
        corIcone="text-teal-600"
        corFundo="bg-teal-50"
        totais={[{ label: 'Valor restante', valor: totalRestante }]}
        colunas={['Descrição', 'Responsável', 'Origem', 'Parcela', 'Restam', 'Valor restante', 'Término']}
        linhas={relatorio.parcelamentosAbertos.map(p => [
          p.descricao,
          p.responsavel,
          ORIGEM_LABEL[p.origem] ?? p.origem,
          `${p.parcelaAtual}/${p.totalParcelas}`,
          p.parcelasRestantes,
          formatBRL(p.valorRestante),
          formatarMes(p.mesTermino),
        ])}
      />
    </div>
  )
}

export default function RelatorioCartoesPage() {
  const router = useRouter()
  const [relatorio, setRelatorio] = useState<RelatorioCartoes | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(async () => {
    setStatus('loading')
    try {
      const dados = await buscarRelatorioCartoes()
      setRelatorio(dados)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function handleBaixarPdf() {
    if (!relatorio || gerando) return
    setGerando(true)
    try {
      const { gerarRelatorioCartoesPdf } = await import('@/lib/gerarRelatorioCartoesPdf')
      await gerarRelatorioCartoesPdf(relatorio)
    } finally {
      setGerando(false)
    }
  }

  async function handleBaixarCsv() {
    if (!relatorio || gerando) return
    setGerando(true)
    try {
      const { gerarRelatorioCartoesCsv } = await import('@/lib/gerarRelatorioCartoesCsv')
      gerarRelatorioCartoesCsv(relatorio)
    } finally {
      setGerando(false)
    }
  }

  const desabilitado = status !== 'ready' || gerando

  return (
    <div className="min-h-screen bg-gray-50 page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 px-4 md:px-6 lg:px-8 z-[10]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/relatorios')}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors flex-none"
            aria-label="Voltar para Relatórios"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" strokeWidth={2} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Relatório de Gastos no Cartão</h1>
        </div>
      </div>

      <div className="page-content space-y-3">
        {status === 'loading' && <RelatorioSkeleton />}

        {status === 'error' && (
          <div className="bg-white rounded-3xl shadow-card border border-gray-100">
            <EmptyState
              icon={CreditCard}
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
