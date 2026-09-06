'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  TrendingUp, Receipt, ShoppingCart, PiggyBank, FileBarChart, Target,
} from 'lucide-react'
import MonthSelector from '@/components/MonthSelector'
import { useMes } from '@/components/MesProvider'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SecaoRelatorio from '@/components/relatorios/SecaoRelatorio'
import KpisRelatorio, { type KpiRelatorio } from '@/components/relatorios/KpisRelatorio'
import DestaquesRelatorio from '@/components/relatorios/DestaquesRelatorio'
import BarrasDistribuicao from '@/components/relatorios/BarrasDistribuicao'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import {
  buscarRelatorioMensal,
  comprasPorCategoria,
  despesasPorCategoria,
  montarDestaquesMensal,
  montarDocumentoMensal,
  pendenciasDoMes,
  taxaPoupanca,
  RELATORIO_EXPLICACOES,
  type RelatorioMensal,
} from '@/lib/relatorioMensal'
import { formatBRL } from '@/lib/format'
import { formatarData, formatarPercentual, variacaoPercentual } from '@/lib/relatoriosFormat'
import { useRelatorio } from '@/lib/useRelatorio'
import type { CelulaRelatorio } from '@/lib/relatorioDocumento'

type VisaoDespesas = 'itens' | 'categorias'
type FiltroStatus = 'todos' | 'pendentes' | 'pagos'

const OPCOES_VISAO = [
  { valor: 'itens' as VisaoDespesas, label: 'Por item' },
  { valor: 'categorias' as VisaoDespesas, label: 'Por categoria' },
]

const OPCOES_STATUS = [
  { valor: 'todos' as FiltroStatus, label: 'Todas' },
  { valor: 'pendentes' as FiltroStatus, label: 'A pagar' },
  { valor: 'pagos' as FiltroStatus, label: 'Pagas' },
]

const CORES_STATUS: Record<string, string> = {
  Pago: 'bg-green-50 text-green-700',
  Recebido: 'bg-green-50 text-green-700',
  Pendente: 'bg-amber-50 text-amber-700',
  Vencida: 'bg-red-50 text-red-600',
}

function Badge({ texto }: { texto: string }) {
  const cor = CORES_STATUS[texto] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-semibold ${cor}`}>
      {texto}
    </span>
  )
}

/** Barra "quanto do previsto já virou realizado" — leitura de execução do mês. */
function BarraExecucao({
  label, realizado, previsto, cor,
}: { label: string; realizado: number; previsto: number; cor: string }) {
  const pct = previsto > 0 ? Math.min(100, (realizado / previsto) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <span className="text-xs text-gray-500 num">
          <span className="font-bold text-gray-900">{formatBRL(realizado)}</span>
          {' de '}{formatBRL(previsto)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${cor} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-gray-400">
        {previsto > 0 ? `${formatarPercentual(pct, 0)} executado` : 'Nada previsto neste mês'}
      </p>
    </div>
  )
}

export default function RelatorioMensalPage() {
  const { mesAtual, setMesAtual } = useMes()
  const [visaoDespesas, setVisaoDespesas] = useState<VisaoDespesas>('itens')
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos')

  const buscar = useCallback(() => buscarRelatorioMensal(mesAtual), [mesAtual])
  const { dados: relatorio, status, atualizando, recarregar } = useRelatorio<RelatorioMensal>(buscar)

  const kpis = useMemo<KpiRelatorio[]>(() => {
    if (!relatorio) return []
    const comp = relatorio.comparativo
    const poupanca = taxaPoupanca(relatorio)
    const pendencias = pendenciasDoMes(relatorio)

    return [
      {
        label: 'Receitas recebidas',
        valor: formatBRL(relatorio.receitas.totalRecebido),
        variacao: comp ? variacaoPercentual(relatorio.receitas.totalRecebido, comp.receitasRecebidas) : undefined,
        comparacao: 'vs. mês anterior',
        detalhe: `Previsto ${formatBRL(relatorio.receitas.totalPrevisto)}`,
      },
      {
        label: 'Despesas pagas',
        valor: formatBRL(relatorio.despesas.totalReal),
        variacao: comp ? variacaoPercentual(relatorio.despesas.totalReal, comp.despesasReais) : undefined,
        comparacao: 'vs. mês anterior',
        subirEhBom: false,
        detalhe: `A pagar ${formatBRL(pendencias.totalPendente)}`,
      },
      {
        label: 'Saldo realizado',
        valor: formatBRL(relatorio.saldoRealizado),
        variacao: comp ? variacaoPercentual(relatorio.saldoRealizado, comp.saldoRealizado) : undefined,
        comparacao: 'vs. mês anterior',
        corValor: relatorio.saldoRealizado >= 0 ? 'text-green-600' : 'text-red-500',
        detalhe: `Previsto ${formatBRL(relatorio.saldoPrevisto)}`,
      },
      {
        label: 'Taxa de poupança',
        valor: poupanca === null ? '—' : formatarPercentual(poupanca, 1),
        detalhe: poupanca === null
          ? 'Sem receita recebida no mês'
          : 'Sobra sobre o que já entrou',
        corValor: poupanca !== null && poupanca < 0 ? 'text-red-500' : 'text-gray-900',
      },
    ]
  }, [relatorio])

  const destaques = useMemo(() => relatorio ? montarDestaquesMensal(relatorio) : [], [relatorio])

  const despesasFiltradas = useMemo(() => {
    if (!relatorio) return []
    if (filtroStatus === 'pendentes') return relatorio.despesas.itens.filter(i => i.status !== 'Pago')
    if (filtroStatus === 'pagos') return relatorio.despesas.itens.filter(i => i.status === 'Pago')
    return relatorio.despesas.itens
  }, [relatorio, filtroStatus])

  const linhasDespesas = useMemo<CelulaRelatorio[][]>(() => {
    if (visaoDespesas === 'categorias') {
      return despesasPorCategoria(despesasFiltradas).map(c => [
        c.chave, `${c.quantidade}`, c.previsto, c.realizado,
      ])
    }
    return despesasFiltradas.map(i => [
      i.item,
      i.categoria,
      i.status,
      i.dataVencimento ? formatarData(i.dataVencimento) : '—',
      i.valorPrevisto,
      i.valorReal !== null ? i.valorReal : '—',
    ])
  }, [despesasFiltradas, visaoDespesas])

  const montarDocumento = useCallback(
    () => (relatorio ? montarDocumentoMensal(relatorio, mesAtual) : null),
    [relatorio, mesAtual],
  )

  return (
    <RelatorioShell
      titulo="Relatório Gerencial Mensal"
      IconeErro={FileBarChart}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
      filtros={<MonthSelector value={mesAtual} onChange={setMesAtual} />}
    >
      {relatorio && (
        <>
          <KpisRelatorio kpis={kpis} />

          <DestaquesRelatorio destaques={destaques} />

          <section className="bg-white rounded-3xl shadow-card border border-gray-100 p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                <Target className="w-4 h-4 text-primary-600" strokeWidth={1.8} />
              </div>
              <h2 className="font-bold text-gray-900 tracking-tight">Execução do mês</h2>
            </div>
            <p className="text-xs text-gray-500 leading-snug">{RELATORIO_EXPLICACOES.execucao}</p>
            <BarraExecucao
              label="Receitas recebidas"
              realizado={relatorio.receitas.totalRecebido}
              previsto={relatorio.receitas.totalPrevisto}
              cor="bg-green-500"
            />
            <BarraExecucao
              label="Despesas pagas"
              realizado={relatorio.despesas.totalReal}
              previsto={relatorio.despesas.totalPrevisto}
              cor="bg-red-400"
            />
            <BarraExecucao
              label="Investimentos aportados"
              realizado={relatorio.investimentos.totalAportado}
              previsto={relatorio.investimentos.totalPlanejado}
              cor="bg-blue-500"
            />
          </section>

          <SecaoRelatorio
            titulo="Receitas"
            explicacao={RELATORIO_EXPLICACOES.receitas}
            Icon={TrendingUp}
            corIcone="text-green-600"
            corFundo="bg-green-50"
            colunas={['Item', 'Responsável', 'Status', 'Previsto', 'Recebido']}
            linhas={relatorio.receitas.itens.map(i => [
              i.item, i.responsavel, i.pago ? 'Recebido' : 'Pendente', i.valorPrevisto, i.valorRecebido,
            ])}
            totais={[
              { label: 'Previsto', valor: relatorio.receitas.totalPrevisto },
              { label: 'Recebido', valor: relatorio.receitas.totalRecebido },
            ]}
            vazio="Nenhuma receita lançada neste mês."
            renderCelula={(valor, colIdx) =>
              colIdx === 2 ? <Badge texto={String(valor)} /> : (typeof valor === 'number' ? formatBRL(valor) : valor)
            }
          />

          <SecaoRelatorio
            titulo="Despesas"
            explicacao={RELATORIO_EXPLICACOES.despesas}
            Icon={Receipt}
            corIcone="text-red-500"
            corFundo="bg-red-50"
            busca={visaoDespesas === 'itens'}
            colunas={visaoDespesas === 'categorias'
              ? ['Categoria', 'Lançamentos', 'Previsto', 'Pago']
              : ['Item', 'Categoria', 'Status', 'Vencimento', 'Previsto', 'Real']}
            linhas={linhasDespesas}
            totais={[
              { label: 'Previsto', valor: despesasFiltradas.reduce((a, i) => a + i.valorPrevisto, 0) },
              { label: 'Pago', valor: despesasFiltradas.reduce((a, i) => a + (i.valorReal ?? 0), 0) },
            ]}
            vazio="Nenhuma despesa neste filtro."
            renderCelula={(valor, colIdx) =>
              visaoDespesas === 'itens' && colIdx === 2
                ? <Badge texto={String(valor)} />
                : (typeof valor === 'number' ? formatBRL(valor) : valor)
            }
          >
            <div className="space-y-2">
              <SeletorOpcoes
                opcoes={OPCOES_VISAO}
                valor={visaoDespesas}
                onChange={setVisaoDespesas}
                ariaLabel="Forma de agrupar as despesas"
              />
              <SeletorOpcoes
                opcoes={OPCOES_STATUS}
                valor={filtroStatus}
                onChange={setFiltroStatus}
                ariaLabel="Filtrar despesas por status"
              />
              {visaoDespesas === 'categorias' && (
                <BarrasDistribuicao
                  itens={despesasPorCategoria(despesasFiltradas).map(c => ({
                    label: c.chave,
                    valor: c.previsto,
                    detalhe: `${c.quantidade} lançamento(s) · pago ${formatBRL(c.realizado)}`,
                  }))}
                  vazio="Nenhuma despesa neste filtro."
                />
              )}
            </div>
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Compras no cartão"
            explicacao={RELATORIO_EXPLICACOES.compras}
            Icon={ShoppingCart}
            corIcone="text-orange-500"
            corFundo="bg-orange-50"
            busca
            colunas={['Data', 'Descrição', 'Responsável', 'Cartão', 'Categoria', 'Valor']}
            linhas={relatorio.compras.itens.map(i => [
              formatarData(i.data), i.descricao, i.responsavel, i.cartao, i.categoria ?? '—', i.valor,
            ])}
            totais={[
              { label: 'Total', valor: relatorio.compras.total },
              { label: 'Compras', valor: `${relatorio.compras.itens.length}` },
              {
                label: 'Ticket médio',
                valor: relatorio.compras.itens.length > 0
                  ? relatorio.compras.total / relatorio.compras.itens.length
                  : 0,
              },
            ]}
            vazio="Nenhuma compra na fatura deste mês."
          >
            {relatorio.compras.itens.length > 0 && (
              <BarrasDistribuicao
                itens={comprasPorCategoria(relatorio.compras.itens).map(c => ({
                  label: c.chave,
                  valor: c.realizado,
                  detalhe: `${c.quantidade} compra(s)`,
                }))}
                limite={6}
              />
            )}
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Investimentos"
            explicacao={RELATORIO_EXPLICACOES.investimentos}
            Icon={PiggyBank}
            corIcone="text-blue-600"
            corFundo="bg-blue-50"
            colunas={['Descrição', 'Percentual', 'Planejado', 'Aportado']}
            linhas={relatorio.investimentos.itens.map(i => [
              i.descricao, `${i.percentual}%`, i.valorPlanejado, i.valorAportado,
            ])}
            totais={[
              { label: 'Planejado', valor: relatorio.investimentos.totalPlanejado },
              { label: 'Aportado', valor: relatorio.investimentos.totalAportado },
            ]}
            vazio="Nenhum investimento cadastrado neste mês."
          />

          <p className="text-xs text-gray-400 leading-snug px-1 pb-1">
            Compras já estão refletidas na fatura do cartão em Despesas — somar as duas seções contaria o mesmo
            gasto duas vezes. Investimentos representam valores destinados a partir do saldo do mês.
          </p>
        </>
      )}
    </RelatorioShell>
  )
}
