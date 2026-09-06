'use client'

import { useCallback, useMemo, useState } from 'react'
import { Target, AlertOctagon, Layers, CalendarRange } from 'lucide-react'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SecaoRelatorio from '@/components/relatorios/SecaoRelatorio'
import KpisRelatorio, { type KpiRelatorio } from '@/components/relatorios/KpisRelatorio'
import DestaquesRelatorio from '@/components/relatorios/DestaquesRelatorio'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import {
  buscarRelatorioOrcamento,
  indicadoresOrcamento,
  montarDestaquesOrcamento,
  montarDocumentoOrcamento,
  JANELAS_ORCAMENTO,
  RELATORIO_ORCAMENTO_EXPLICACOES,
  type JanelaOrcamento,
  type RelatorioOrcamento,
} from '@/lib/relatorioOrcamento'
import { useRelatorio } from '@/lib/useRelatorio'
import { formatBRL } from '@/lib/format'
import { formatarMes, formatarPercentual, formatarVariacao } from '@/lib/relatoriosFormat'

const OPCOES_JANELA = JANELAS_ORCAMENTO.map(m => ({ valor: m, label: `${m} meses` }))

export default function RelatorioOrcamentoPage() {
  const [janela, setJanela] = useState<JanelaOrcamento>(6)

  const buscar = useCallback(() => buscarRelatorioOrcamento(janela), [janela])
  const { dados: relatorio, status, atualizando, recarregar } = useRelatorio<RelatorioOrcamento>(buscar)

  const indicadores = useMemo(() => (relatorio ? indicadoresOrcamento(relatorio) : null), [relatorio])
  const destaques = useMemo(() => (relatorio ? montarDestaquesOrcamento(relatorio) : []), [relatorio])

  const kpis = useMemo<KpiRelatorio[]>(() => {
    if (!relatorio || !indicadores) return []
    return [
      {
        label: 'Aderência ao plano',
        valor: indicadores.aderencia === null ? '—' : formatarPercentual(indicadores.aderencia, 1),
        detalhe: '100% = pagou exatamente o previsto',
        corValor: indicadores.aderencia !== null && indicadores.aderencia > 105
          ? 'text-red-500'
          : 'text-gray-900',
      },
      {
        label: 'Desvio no período',
        valor: `${indicadores.desvioTotal >= 0 ? '+' : '-'}${formatBRL(Math.abs(indicadores.desvioTotal))}`,
        detalhe: `${formatBRL(relatorio.totalRealizado)} pagos de ${formatBRL(relatorio.totalPrevisto)}`,
        corValor: indicadores.desvioTotal > 0 ? 'text-red-500' : 'text-green-600',
      },
      {
        label: 'Estouros',
        valor: formatBRL(relatorio.totalEstourado),
        detalhe: `${indicadores.itensEstourados} item(ns) acima do previsto`,
        corValor: 'text-red-500',
      },
      {
        label: 'Economias',
        valor: formatBRL(relatorio.totalEconomizado),
        detalhe: `Em aberto: ${formatBRL(relatorio.totalEmAberto)}`,
        corValor: 'text-green-600',
      },
    ]
  }, [relatorio, indicadores])

  const montarDocumento = useCallback(
    () => (relatorio ? montarDocumentoOrcamento(relatorio) : null),
    [relatorio],
  )

  return (
    <RelatorioShell
      titulo="Previsto x Realizado"
      IconeErro={Target}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
      filtros={
        <SeletorOpcoes
          opcoes={OPCOES_JANELA}
          valor={janela}
          onChange={v => setJanela(v as JanelaOrcamento)}
          ariaLabel="Janela analisada"
        />
      }
    >
      {relatorio && indicadores && (
        <>
          <KpisRelatorio kpis={kpis} />

          <DestaquesRelatorio destaques={destaques} />

          <SecaoRelatorio
            titulo="Aderência mês a mês"
            explicacao={RELATORIO_ORCAMENTO_EXPLICACOES.meses}
            Icon={CalendarRange}
            corIcone="text-amber-600"
            corFundo="bg-amber-50"
            colunas={['Mês', 'Previsto', 'Pago', 'Desvio', 'Aderência', 'Em aberto']}
            linhas={relatorio.porMes.map(m => [
              formatarMes(m.mes), m.previsto, m.realizado, m.realizado - m.previsto,
              m.aderencia === null ? '—' : formatarPercentual(m.aderencia, 1),
              m.emAberto,
            ])}
            limiteInicial={0}
            totais={[
              { label: 'Previsto', valor: relatorio.totalPrevisto },
              { label: 'Pago', valor: relatorio.totalRealizado },
            ]}
          >
            <GraficoBarrasMeses
              pontos={relatorio.porMes.map(m => ({
                label: formatarMes(m.mes),
                valor: m.realizado,
                destaque: m.realizado > m.previsto,
              }))}
              media={relatorio.porMes.length > 0 ? relatorio.totalPrevisto / relatorio.porMes.length : undefined}
            />
            <p className="text-[11px] text-gray-400">
              Barras destacadas são meses em que o pago superou o previsto. A linha tracejada é o previsto médio.
            </p>
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Desvios por categoria"
            explicacao={RELATORIO_ORCAMENTO_EXPLICACOES.categorias}
            Icon={Layers}
            corIcone="text-violet-600"
            corFundo="bg-violet-50"
            colunas={['Categoria', 'Meses', 'Previsto', 'Pago', 'Desvio', 'Desvio %']}
            linhas={relatorio.categorias.map(c => [
              c.chave, `${c.mesesPagos}`, c.previsto, c.realizado, c.desvio, formatarVariacao(c.desvioPct),
            ])}
            vazio="Nenhum lançamento pago na janela."
          />

          <SecaoRelatorio
            titulo="Desvios por item"
            explicacao={RELATORIO_ORCAMENTO_EXPLICACOES.itens}
            Icon={Target}
            corIcone="text-sky-600"
            corFundo="bg-sky-50"
            busca
            colunas={['Item', 'Categoria', 'Meses', 'Estouros', 'Previsto', 'Pago', 'Desvio', 'Desvio %']}
            linhas={relatorio.itens.map(i => [
              i.chave, i.categoria, `${i.mesesPagos}`, `${i.mesesEstourados}`,
              i.previsto, i.realizado, i.desvio, formatarVariacao(i.desvioPct),
            ])}
            totais={[
              { label: 'Estouros', valor: relatorio.totalEstourado },
              { label: 'Economias', valor: relatorio.totalEconomizado },
            ]}
            vazio="Nenhum lançamento pago na janela."
          />

          <SecaoRelatorio
            titulo="Itens que estouram todo mês"
            explicacao="Itens que ficaram acima do previsto na maioria dos meses em que foram pagos — sinal de valor previsto desatualizado, não de descontrole pontual."
            Icon={AlertOctagon}
            corIcone="text-red-500"
            corFundo="bg-red-50"
            colunas={['Item', 'Meses pagos', 'Estouros', 'Previsto', 'Pago', 'Desvio']}
            linhas={indicadores.itensCronicos.map(i => [
              i.chave, `${i.mesesPagos}`, `${i.mesesEstourados}`, i.previsto, i.realizado, i.desvio,
            ])}
            vazio="Nenhum item estourou de forma recorrente. O planejamento está calibrado."
          />

          <p className="text-xs text-gray-400 leading-snug px-1 pb-1">
            {RELATORIO_ORCAMENTO_EXPLICACOES.metodologia}
          </p>
        </>
      )}
    </RelatorioShell>
  )
}
