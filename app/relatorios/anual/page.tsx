'use client'

import { useCallback, useMemo, useState } from 'react'
import { CalendarRange, PieChart, GitCompareArrows } from 'lucide-react'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SecaoRelatorio from '@/components/relatorios/SecaoRelatorio'
import KpisRelatorio, { type KpiRelatorio } from '@/components/relatorios/KpisRelatorio'
import DestaquesRelatorio from '@/components/relatorios/DestaquesRelatorio'
import BarrasDistribuicao from '@/components/relatorios/BarrasDistribuicao'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import {
  anosDisponiveis,
  buscarRelatorioAnual,
  indicadoresAnuais,
  montarDestaquesAnual,
  montarDocumentoAnual,
  RELATORIO_ANUAL_EXPLICACOES,
  type RelatorioAnual,
} from '@/lib/relatorioAnual'
import { useRelatorio } from '@/lib/useRelatorio'
import { formatBRL } from '@/lib/format'
import { formatarPercentual, formatarVariacao, variacaoPercentual } from '@/lib/relatoriosFormat'

const OPCOES_ANO = anosDisponiveis().map(a => ({ valor: a, label: `${a}` }))

export default function RelatorioAnualPage() {
  const [ano, setAno] = useState<number>(anosDisponiveis()[0])

  const buscar = useCallback(() => buscarRelatorioAnual(ano), [ano])
  const { dados: relatorio, status, atualizando, recarregar } = useRelatorio<RelatorioAnual>(buscar)

  const indicadores = useMemo(() => (relatorio ? indicadoresAnuais(relatorio) : null), [relatorio])
  const destaques = useMemo(() => (relatorio ? montarDestaquesAnual(relatorio) : []), [relatorio])

  const kpis = useMemo<KpiRelatorio[]>(() => {
    if (!relatorio || !indicadores) return []
    const anterior = relatorio.anoAnterior

    return [
      {
        label: 'Receitas no ano',
        valor: formatBRL(relatorio.totalReceitas),
        variacao: anterior ? variacaoPercentual(relatorio.totalReceitas, anterior.receitas) : undefined,
        comparacao: `vs. ${relatorio.ano - 1}`,
        detalhe: `Média ${formatBRL(indicadores.mediaReceitas)}/mês`,
      },
      {
        label: 'Despesas no ano',
        valor: formatBRL(relatorio.totalDespesas),
        variacao: anterior ? variacaoPercentual(relatorio.totalDespesas, anterior.despesas) : undefined,
        comparacao: `vs. ${relatorio.ano - 1}`,
        subirEhBom: false,
        detalhe: `Média ${formatBRL(indicadores.mediaDespesas)}/mês`,
      },
      {
        label: 'Saldo do ano',
        valor: formatBRL(relatorio.saldoAno),
        corValor: relatorio.saldoAno >= 0 ? 'text-green-600' : 'text-red-500',
        detalhe: `${indicadores.mesesNoVermelho.length} mês(es) no vermelho`,
      },
      {
        label: 'Taxa de poupança',
        valor: indicadores.taxaPoupanca === null ? '—' : formatarPercentual(indicadores.taxaPoupanca, 1),
        detalhe: `Aportes: ${formatBRL(relatorio.totalAportes)}`,
        corValor: (indicadores.taxaPoupanca ?? 0) < 0 ? 'text-red-500' : 'text-gray-900',
      },
    ]
  }, [relatorio, indicadores])

  const montarDocumento = useCallback(
    () => (relatorio ? montarDocumentoAnual(relatorio) : null),
    [relatorio],
  )

  return (
    <RelatorioShell
      titulo="Fechamento Anual"
      IconeErro={CalendarRange}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
      filtros={
        <SeletorOpcoes
          opcoes={OPCOES_ANO}
          valor={ano}
          onChange={v => setAno(Number(v))}
          ariaLabel="Ano do fechamento"
        />
      }
    >
      {relatorio && indicadores && (
        <>
          <KpisRelatorio kpis={kpis} />

          <DestaquesRelatorio destaques={destaques} />

          <SecaoRelatorio
            titulo={`Mês a mês em ${relatorio.ano}`}
            explicacao={RELATORIO_ANUAL_EXPLICACOES.meses}
            Icon={CalendarRange}
            corIcone="text-green-600"
            corFundo="bg-green-50"
            colunas={['Mês', 'Receita', 'Despesa', 'Saldo', 'Aportes', 'Cartão']}
            linhas={relatorio.meses.map(m => [
              m.label, m.receitasRecebidas, m.despesasReais, m.saldo, m.aportes, m.gastoCartao,
            ])}
            limiteInicial={0}
            totais={[
              { label: 'Receitas', valor: relatorio.totalReceitas },
              { label: 'Despesas', valor: relatorio.totalDespesas },
              { label: 'Saldo', valor: relatorio.saldoAno },
            ]}
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500">Despesas pagas por mês</p>
                <GraficoBarrasMeses
                  pontos={relatorio.meses.map(m => ({ label: m.label, valor: m.despesasReais }))}
                  media={indicadores.mediaDespesas}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500">Receitas recebidas por mês</p>
                <GraficoBarrasMeses
                  pontos={relatorio.meses.map(m => ({ label: m.label, valor: m.receitasRecebidas }))}
                  media={indicadores.mediaReceitas}
                />
              </div>
            </div>
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Despesas por categoria no ano"
            explicacao={RELATORIO_ANUAL_EXPLICACOES.categorias}
            Icon={PieChart}
            corIcone="text-violet-600"
            corFundo="bg-violet-50"
            busca
            colunas={['Categoria', 'Total', 'Participação']}
            linhas={relatorio.categorias.map(c => [
              c.categoria, c.total, formatarPercentual(c.participacao, 1),
            ])}
            vazio="Nenhuma despesa categorizada neste ano."
          >
            <BarrasDistribuicao
              itens={relatorio.categorias.map(c => ({ label: c.categoria, valor: c.total }))}
              limite={8}
            />
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo={`${relatorio.ano} contra ${relatorio.ano - 1}`}
            Icon={GitCompareArrows}
            corIcone="text-sky-600"
            corFundo="bg-sky-50"
            colunas={['Indicador', `${relatorio.ano - 1}`, `${relatorio.ano}`, 'Variação']}
            linhas={relatorio.anoAnterior
              ? [
                  ['Receitas recebidas', relatorio.anoAnterior.receitas, relatorio.totalReceitas,
                    formatarVariacao(variacaoPercentual(relatorio.totalReceitas, relatorio.anoAnterior.receitas))],
                  ['Despesas pagas', relatorio.anoAnterior.despesas, relatorio.totalDespesas,
                    formatarVariacao(variacaoPercentual(relatorio.totalDespesas, relatorio.anoAnterior.despesas))],
                  ['Saldo', relatorio.anoAnterior.saldo, relatorio.saldoAno,
                    formatarVariacao(variacaoPercentual(relatorio.saldoAno, relatorio.anoAnterior.saldo))],
                ]
              : []}
            vazio={`Sem dados de ${relatorio.ano - 1} para comparar.`}
          />

          <p className="text-xs text-gray-400 leading-snug px-1 pb-1">
            O gasto no cartão aparece como informação à parte: ele já entra nas despesas pelo pagamento da
            fatura, então somar as duas colunas contaria o mesmo dinheiro duas vezes.
          </p>
        </>
      )}
    </RelatorioShell>
  )
}
