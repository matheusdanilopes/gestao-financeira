'use client'

import { useCallback, useMemo, useState } from 'react'
import { BarChart3, Repeat, LineChart, Tags } from 'lucide-react'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SecaoRelatorio from '@/components/relatorios/SecaoRelatorio'
import KpisRelatorio, { type KpiRelatorio } from '@/components/relatorios/KpisRelatorio'
import DestaquesRelatorio from '@/components/relatorios/DestaquesRelatorio'
import BarrasDistribuicao from '@/components/relatorios/BarrasDistribuicao'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import SeletorOpcoes from '@/components/relatorios/SeletorOpcoes'
import {
  buscarRelatorioCategorias,
  indicadoresCategorias,
  montarDestaquesCategorias,
  montarDocumentoCategorias,
  FONTE_LABEL,
  JANELAS_CATEGORIAS,
  RELATORIO_CATEGORIAS_EXPLICACOES,
  type FonteCategorias,
  type JanelaCategorias,
  type RelatorioCategorias,
} from '@/lib/relatorioCategorias'
import { useRelatorio } from '@/lib/useRelatorio'
import { formatBRL } from '@/lib/format'
import { formatarMes, formatarPercentual, formatarVariacao } from '@/lib/relatoriosFormat'

const OPCOES_JANELA = JANELAS_CATEGORIAS.map(m => ({ valor: m, label: `${m} meses` }))

const OPCOES_FONTE = (Object.keys(FONTE_LABEL) as FonteCategorias[]).map(f => ({
  valor: f,
  label: f === 'cartao' ? 'Cartão' : f === 'contas' ? 'Contas' : 'Ambos',
}))

export default function RelatorioCategoriasPage() {
  const [janela, setJanela] = useState<JanelaCategorias>(6)
  const [fonte, setFonte] = useState<FonteCategorias>('cartao')

  const buscar = useCallback(() => buscarRelatorioCategorias(janela, fonte), [janela, fonte])
  const { dados: relatorio, status, atualizando, recarregar } = useRelatorio<RelatorioCategorias>(buscar)

  const indicadores = useMemo(() => (relatorio ? indicadoresCategorias(relatorio) : null), [relatorio])
  const destaques = useMemo(() => (relatorio ? montarDestaquesCategorias(relatorio) : []), [relatorio])

  const kpis = useMemo<KpiRelatorio[]>(() => {
    if (!indicadores || !relatorio) return []
    return [
      {
        label: `Total ${relatorio.janela} meses`,
        valor: formatBRL(indicadores.totalPeriodo),
        detalhe: FONTE_LABEL[relatorio.fonte],
      },
      {
        label: 'Média mensal',
        valor: formatBRL(indicadores.mediaMensal),
        detalhe: `${indicadores.categoriasAtivas} categorias com gasto`,
      },
      {
        label: 'Último mês',
        valor: formatBRL(indicadores.ultimoMes),
        variacao: indicadores.variacaoUltimoVsMedia,
        comparacao: 'vs. média',
        subirEhBom: false,
      },
      {
        label: 'Concentração top 3',
        valor: formatarPercentual(indicadores.concentracaoTop3, 0),
        detalhe: relatorio.categorias.slice(0, 3).map(c => c.categoria).join(', ') || '—',
      },
    ]
  }, [indicadores, relatorio])

  const montarDocumento = useCallback(
    () => (relatorio ? montarDocumentoCategorias(relatorio) : null),
    [relatorio],
  )

  return (
    <RelatorioShell
      titulo="Raio-X por Categoria"
      IconeErro={Tags}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
      filtros={
        <div className="space-y-2">
          <SeletorOpcoes
            opcoes={OPCOES_JANELA}
            valor={janela}
            onChange={v => setJanela(v as JanelaCategorias)}
            ariaLabel="Janela de meses analisada"
          />
          <SeletorOpcoes
            opcoes={OPCOES_FONTE}
            valor={fonte}
            onChange={setFonte}
            ariaLabel="Fonte dos dados"
          />
        </div>
      }
    >
      {relatorio && indicadores && (
        <>
          <KpisRelatorio kpis={kpis} />

          <DestaquesRelatorio destaques={destaques} />

          <SecaoRelatorio
            titulo="Evolução mensal"
            explicacao={RELATORIO_CATEGORIAS_EXPLICACOES.evolucao}
            Icon={LineChart}
            corIcone="text-sky-600"
            corFundo="bg-sky-50"
            colunas={['Mês', 'Total']}
            linhas={relatorio.meses.map((mes, idx) => [formatarMes(mes), relatorio.seriePeriodo[idx]])}
            limiteInicial={0}
            totais={[{ label: 'Total do período', valor: indicadores.totalPeriodo }]}
            vazio="Nenhum gasto registrado nesta janela."
          >
            <GraficoBarrasMeses
              pontos={relatorio.meses.map((mes, idx) => ({
                label: formatarMes(mes),
                valor: relatorio.seriePeriodo[idx],
                destaque: idx === relatorio.meses.length - 1,
              }))}
              media={indicadores.mediaMensal}
            />
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Ranking de categorias"
            explicacao={RELATORIO_CATEGORIAS_EXPLICACOES.ranking}
            Icon={BarChart3}
            corIcone="text-violet-600"
            corFundo="bg-violet-50"
            busca
            colunas={['Categoria', 'Lanç.', 'Total', 'Part.', 'Média/mês', 'Último mês', 'Últ. vs média']}
            linhas={relatorio.categorias.map(c => [
              c.categoria,
              `${c.quantidade}`,
              c.total,
              formatarPercentual(c.participacao, 1),
              c.mediaMensal,
              c.ultimoMes,
              formatarVariacao(c.variacaoVsMedia),
            ])}
            totais={[{ label: 'Total do período', valor: indicadores.totalPeriodo }]}
            vazio="Nenhuma categoria com gasto nesta janela."
          >
            <BarrasDistribuicao
              itens={relatorio.categorias.map(c => ({
                label: c.categoria,
                valor: c.total,
                detalhe: `${c.quantidade} lançamento(s) · média ${formatBRL(c.mediaMensal)}/mês`,
              }))}
              limite={8}
            />
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Gastos que se repetem"
            explicacao={RELATORIO_CATEGORIAS_EXPLICACOES.recorrentes}
            Icon={Repeat}
            corIcone="text-amber-600"
            corFundo="bg-amber-50"
            busca
            colunas={['Descrição', 'Categoria', 'Vezes', 'Total', 'Média']}
            linhas={relatorio.recorrentes.map(r => [
              r.descricao, r.categoria, `${r.vezes}`, r.total, r.total / r.vezes,
            ])}
            vazio="Nenhum gasto se repetiu nesta janela."
          />

          <p className="text-xs text-gray-400 leading-snug px-1 pb-1">
            {RELATORIO_CATEGORIAS_EXPLICACOES.fonte}
          </p>
        </>
      )}
    </RelatorioShell>
  )
}
