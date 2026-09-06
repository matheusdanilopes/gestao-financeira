'use client'

import { useCallback, useMemo, useState } from 'react'
import { History, TrendingUp, Layers, CreditCard, PieChart } from 'lucide-react'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SecaoRelatorio from '@/components/relatorios/SecaoRelatorio'
import KpisRelatorio, { type KpiRelatorio } from '@/components/relatorios/KpisRelatorio'
import DestaquesRelatorio from '@/components/relatorios/DestaquesRelatorio'
import BarrasDistribuicao from '@/components/relatorios/BarrasDistribuicao'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import {
  buscarRelatorioCartoes,
  indicadoresCartoes,
  montarDestaquesCartoes,
  montarDocumentoCartoes,
  JANELAS_HISTORICO,
  ORIGEM_LABEL,
  RELATORIO_CARTOES_EXPLICACOES,
  type JanelaHistorico,
  type MesGasto,
  type RelatorioCartoes,
} from '@/lib/relatorioCartoes'
import { formatBRL } from '@/lib/format'
import { formatarMes } from '@/lib/relatoriosFormat'
import { useRelatorio } from '@/lib/useRelatorio'
import type { CelulaRelatorio } from '@/lib/relatorioDocumento'

type FiltroResponsavel = 'todos' | 'Matheus' | 'Jeniffer' | 'Conjunto'

const OPCOES_JANELA = JANELAS_HISTORICO.map(m => ({ valor: m, label: `${m} meses` }))

const OPCOES_RESPONSAVEL = [
  { valor: 'todos' as FiltroResponsavel, label: 'Todos' },
  { valor: 'Matheus' as FiltroResponsavel, label: 'Matheus' },
  { valor: 'Jeniffer' as FiltroResponsavel, label: 'Jeniffer' },
  { valor: 'Conjunto' as FiltroResponsavel, label: 'Conjunto' },
]

function linhasMesGasto(meses: MesGasto[]): CelulaRelatorio[][] {
  return meses.map(m => [formatarMes(m.mes), m.total, m.matheus, m.jeniffer, m.conjunto])
}

export default function RelatorioCartoesPage() {
  const [janela, setJanela] = useState<JanelaHistorico>(12)
  const [filtroResponsavel, setFiltroResponsavel] = useState<FiltroResponsavel>('todos')

  const buscar = useCallback(
    () => buscarRelatorioCartoes(new Date(), { mesesHistorico: janela }),
    [janela],
  )
  const { dados: relatorio, status, atualizando, recarregar } = useRelatorio<RelatorioCartoes>(buscar)

  const indicadores = useMemo(() => (relatorio ? indicadoresCartoes(relatorio) : null), [relatorio])
  const destaques = useMemo(() => (relatorio ? montarDestaquesCartoes(relatorio) : []), [relatorio])

  const kpis = useMemo<KpiRelatorio[]>(() => {
    if (!indicadores) return []
    return [
      {
        label: `Total ${janela} meses`,
        valor: formatBRL(indicadores.totalPeriodo),
        detalhe: `${relatorio?.historico.reduce((a, m) => a + m.quantidade, 0) ?? 0} compras`,
      },
      {
        label: 'Média mensal',
        valor: formatBRL(indicadores.mediaMensal),
        detalhe: indicadores.ultimoMes
          ? `Último mês: ${formatBRL(indicadores.ultimoMes.total)}`
          : undefined,
        variacao: indicadores.variacaoUltimoVsMedia,
        comparacao: 'último vs. média',
        subirEhBom: false,
      },
      {
        label: 'Próxima fatura projetada',
        valor: formatBRL(indicadores.proximaFaturaProjetada),
        detalhe: 'Só parcelas já lançadas',
      },
      {
        label: 'Comprometido em parcelas',
        valor: formatBRL(indicadores.comprometidoParcelas),
        detalhe: `${relatorio?.parcelamentosAbertos.length ?? 0} parcelamento(s) em aberto`,
        corValor: 'text-violet-600',
      },
    ]
  }, [indicadores, janela, relatorio])

  const parcelamentosFiltrados = useMemo(() => {
    if (!relatorio) return []
    if (filtroResponsavel === 'todos') return relatorio.parcelamentosAbertos
    if (filtroResponsavel === 'Conjunto') {
      return relatorio.parcelamentosAbertos.filter(p => p.responsavel !== 'Matheus' && p.responsavel !== 'Jeniffer')
    }
    return relatorio.parcelamentosAbertos.filter(p => p.responsavel === filtroResponsavel)
  }, [relatorio, filtroResponsavel])

  const montarDocumento = useCallback(
    () => (relatorio ? montarDocumentoCartoes(relatorio, janela) : null),
    [relatorio, janela],
  )

  return (
    <RelatorioShell
      titulo="Relatório de Gastos no Cartão"
      IconeErro={CreditCard}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
      filtros={
        <SeletorOpcoes
          opcoes={OPCOES_JANELA}
          valor={janela}
          onChange={v => setJanela(v as JanelaHistorico)}
          ariaLabel="Janela do histórico de gastos"
        />
      }
    >
      {relatorio && indicadores && (
        <>
          <KpisRelatorio kpis={kpis} />

          <DestaquesRelatorio destaques={destaques} />

          <SecaoRelatorio
            titulo={`Histórico de gastos (${janela} meses)`}
            explicacao={RELATORIO_CARTOES_EXPLICACOES.historico}
            Icon={History}
            corIcone="text-orange-500"
            corFundo="bg-orange-50"
            colunas={['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto']}
            linhas={linhasMesGasto(relatorio.historico)}
            limiteInicial={janela > 12 ? 12 : 0}
            totais={[
              { label: `Total ${janela} meses`, valor: indicadores.totalPeriodo },
              { label: 'Média', valor: indicadores.mediaMensal },
            ]}
          >
            <GraficoBarrasMeses
              pontos={relatorio.historico.map(m => ({
                label: formatarMes(m.mes),
                valor: m.total,
                destaque: m.mes.getTime() === indicadores.ultimoMes?.mes.getTime(),
              }))}
              media={indicadores.mediaMensal}
            />
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Para onde foi o dinheiro"
            explicacao={RELATORIO_CARTOES_EXPLICACOES.categorias}
            Icon={PieChart}
            corIcone="text-sky-600"
            corFundo="bg-sky-50"
            colunas={['Categoria', 'Compras', 'Total', 'Média por compra']}
            linhas={relatorio.porCategoria.map(c => [
              c.chave,
              `${c.quantidade}`,
              c.total,
              c.quantidade > 0 ? c.total / c.quantidade : 0,
            ])}
            totais={[{ label: 'Total do período', valor: indicadores.totalPeriodo }]}
            vazio="Nenhuma compra categorizada no período."
          >
            <BarrasDistribuicao
              itens={relatorio.porCategoria.map(c => ({
                label: c.chave,
                valor: c.total,
                detalhe: `${c.quantidade} compra(s)`,
              }))}
              limite={7}
            />
            {relatorio.porCartao.length > 1 && (
              <div className="pt-1 space-y-2">
                <p className="text-xs font-semibold text-gray-500">Por cartão</p>
                <BarrasDistribuicao
                  itens={relatorio.porCartao.map(c => ({ label: c.chave, valor: c.total }))}
                />
              </div>
            )}
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Projeção de parcelamentos (12 meses)"
            explicacao={RELATORIO_CARTOES_EXPLICACOES.projecao}
            Icon={TrendingUp}
            corIcone="text-violet-600"
            corFundo="bg-violet-50"
            colunas={['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto']}
            linhas={linhasMesGasto(relatorio.projecao)}
            limiteInicial={0}
            totais={[{ label: 'Total projetado', valor: indicadores.totalProjetado }]}
          >
            <GraficoBarrasMeses
              pontos={relatorio.projecao.map(m => ({
                label: formatarMes(m.mes),
                valor: m.total,
                projetado: true,
              }))}
            />
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Parcelamentos em aberto"
            explicacao={RELATORIO_CARTOES_EXPLICACOES.parcelamentosAbertos}
            Icon={Layers}
            corIcone="text-teal-600"
            corFundo="bg-teal-50"
            busca
            colunas={['Descrição', 'Responsável', 'Origem', 'Parcela', 'Restam', 'Parcela (R$)', 'Falta pagar', 'Término']}
            linhas={parcelamentosFiltrados.map(p => [
              p.descricao,
              p.responsavel || 'Conjunto',
              ORIGEM_LABEL[p.origem] ?? p.origem,
              `${p.parcelaAtual}/${p.totalParcelas}`,
              `${p.parcelasRestantes}`,
              p.valorParcela,
              p.valorRestante,
              formatarMes(p.mesTermino),
            ])}
            totais={[
              { label: 'Falta pagar', valor: parcelamentosFiltrados.reduce((a, p) => a + p.valorRestante, 0) },
              { label: 'Peso mensal', valor: parcelamentosFiltrados.reduce((a, p) => a + p.valorParcela, 0) },
            ]}
            vazio="Nenhum parcelamento em aberto neste filtro."
          >
            <SeletorOpcoes
              opcoes={OPCOES_RESPONSAVEL}
              valor={filtroResponsavel}
              onChange={setFiltroResponsavel}
              ariaLabel="Filtrar parcelamentos por responsável"
            />
          </SecaoRelatorio>

          <p className="text-xs text-gray-400 leading-snug px-1 pb-1">
            A projeção considera apenas parcelas já lançadas: compras futuras, assinaturas ainda não cobradas e
            aumentos de fatura não entram na conta.
          </p>
        </>
      )}
    </RelatorioShell>
  )
}
