'use client'

import { useMemo } from 'react'
import { RepeatIcon, CalendarClock, PauseCircle, TrendingUp, PieChart } from 'lucide-react'
import RelatorioShell from '@/components/relatorios/RelatorioShell'
import SecaoRelatorio from '@/components/relatorios/SecaoRelatorio'
import KpisRelatorio, { type KpiRelatorio } from '@/components/relatorios/KpisRelatorio'
import DestaquesRelatorio from '@/components/relatorios/DestaquesRelatorio'
import BarrasDistribuicao from '@/components/relatorios/BarrasDistribuicao'
import GraficoBarrasMeses from '@/components/relatorios/GraficoBarrasMeses'
import {
  buscarRelatorioAssinaturas,
  calendarioCobrancas,
  montarDestaquesAssinaturas,
  montarDocumentoAssinaturas,
  RELATORIO_ASSINATURAS_EXPLICACOES,
  type RelatorioAssinaturas,
} from '@/lib/relatorioAssinaturas'
import { useRelatorio } from '@/lib/useRelatorio'
import { formatBRL } from '@/lib/format'
import { formatarMes, formatarPercentual, formatarVariacao, variacaoPercentual } from '@/lib/relatoriosFormat'

export default function RelatorioAssinaturasPage() {
  const { dados: relatorio, status, atualizando, recarregar } =
    useRelatorio<RelatorioAssinaturas>(buscarRelatorioAssinaturas)

  const destaques = useMemo(() => (relatorio ? montarDestaquesAssinaturas(relatorio) : []), [relatorio])

  const kpis = useMemo<KpiRelatorio[]>(() => {
    if (!relatorio) return []
    const primeiro = relatorio.evolucao[0]
    const ultimo = relatorio.evolucao[relatorio.evolucao.length - 1]

    return [
      {
        label: 'Custo mensal',
        valor: formatBRL(relatorio.custoMensal),
        variacao: primeiro && ultimo ? variacaoPercentual(ultimo.total, primeiro.total) : undefined,
        comparacao: 'em 12 meses',
        subirEhBom: false,
        detalhe: `${relatorio.ativas.length} assinatura(s) ativa(s)`,
      },
      {
        label: 'Custo anual',
        valor: formatBRL(relatorio.custoAnual),
        detalhe: 'Projeção do valor atual × 12',
      },
      {
        label: 'Ticket médio',
        valor: formatBRL(relatorio.ativas.length > 0 ? relatorio.custoMensal / relatorio.ativas.length : 0),
        detalhe: 'Por assinatura ativa',
      },
      {
        label: 'Economia com pausas',
        valor: formatBRL(relatorio.economiaPausadas),
        detalhe: `${relatorio.inativas.length} pausada(s)/cancelada(s)`,
        corValor: relatorio.economiaPausadas > 0 ? 'text-green-600' : 'text-gray-900',
      },
    ]
  }, [relatorio])

  const montarDocumento = () => (relatorio ? montarDocumentoAssinaturas(relatorio) : null)

  return (
    <RelatorioShell
      titulo="Relatório de Assinaturas"
      IconeErro={RepeatIcon}
      status={status}
      atualizando={atualizando}
      onRecarregar={recarregar}
      montarDocumento={montarDocumento}
      avisos={relatorio?.erros}
    >
      {relatorio && (
        <>
          <KpisRelatorio kpis={kpis} />

          <DestaquesRelatorio destaques={destaques} />

          <SecaoRelatorio
            titulo="Assinaturas ativas"
            explicacao={RELATORIO_ASSINATURAS_EXPLICACOES.ativas}
            Icon={RepeatIcon}
            corIcone="text-indigo-600"
            corFundo="bg-indigo-50"
            busca
            colunas={['Assinatura', 'Categoria', 'Responsável', 'Cartão', 'Dia', 'Mensal', 'Anual', 'Part.']}
            linhas={relatorio.ativas.map(a => [
              a.nome, a.categoria, a.responsavel, a.cartao,
              a.diaCobranca !== null ? `${a.diaCobranca}` : '—',
              a.valorMensal, a.valorAnual, formatarPercentual(a.participacao, 1),
            ])}
            totais={[
              { label: 'Mensal', valor: relatorio.custoMensal },
              { label: 'Anual', valor: relatorio.custoAnual },
            ]}
            vazio="Nenhuma assinatura ativa cadastrada."
          />

          <SecaoRelatorio
            titulo="Onde o recorrente pesa"
            Icon={PieChart}
            corIcone="text-violet-600"
            corFundo="bg-violet-50"
            colunas={['Categoria', 'Assinaturas', 'Mensal', 'Anual']}
            linhas={relatorio.porCategoria.map(c => [c.chave, `${c.quantidade}`, c.total, c.total * 12])}
            totais={[{ label: 'Mensal', valor: relatorio.custoMensal }]}
            vazio="Nenhuma assinatura ativa para agrupar."
          >
            <BarrasDistribuicao
              itens={relatorio.porCategoria.map(c => ({
                label: c.chave,
                valor: c.total,
                detalhe: `${c.quantidade} assinatura(s)`,
              }))}
            />
            {relatorio.porResponsavel.length > 1 && (
              <div className="pt-1 space-y-2">
                <p className="text-xs font-semibold text-gray-500">Por responsável</p>
                <BarrasDistribuicao
                  itens={relatorio.porResponsavel.map(r => ({ label: r.chave, valor: r.total }))}
                />
              </div>
            )}
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Evolução do custo recorrente"
            explicacao={RELATORIO_ASSINATURAS_EXPLICACOES.evolucao}
            Icon={TrendingUp}
            corIcone="text-sky-600"
            corFundo="bg-sky-50"
            colunas={['Mês', 'Ativas', 'Custo mensal']}
            linhas={relatorio.evolucao.map(e => [formatarMes(e.mes), `${e.quantidade}`, e.total])}
            limiteInicial={0}
          >
            <GraficoBarrasMeses
              pontos={relatorio.evolucao.map((e, idx) => ({
                label: formatarMes(e.mes),
                valor: e.total,
                destaque: idx === relatorio.evolucao.length - 1,
              }))}
            />
          </SecaoRelatorio>

          <SecaoRelatorio
            titulo="Calendário de cobranças"
            explicacao={RELATORIO_ASSINATURAS_EXPLICACOES.calendario}
            Icon={CalendarClock}
            corIcone="text-amber-600"
            corFundo="bg-amber-50"
            colunas={['Período do mês', 'Assinaturas', 'Valor']}
            linhas={calendarioCobrancas(relatorio).map(f => [f.chave, `${f.quantidade}`, f.total])}
            vazio="Nenhuma assinatura ativa com dia de cobrança."
          />

          <SecaoRelatorio
            titulo="Reajustes no ano"
            explicacao={RELATORIO_ASSINATURAS_EXPLICACOES.reajustes}
            Icon={TrendingUp}
            corIcone="text-red-500"
            corFundo="bg-red-50"
            colunas={['Assinatura', 'Há 12 meses', 'Hoje', 'Variação']}
            linhas={relatorio.ativas
              .filter(a => a.valorAnterior !== null && a.variacaoAno !== null && Math.abs(a.variacaoAno) >= 0.5)
              .map(a => [a.nome, a.valorAnterior ?? 0, a.valorMensal, formatarVariacao(a.variacaoAno)])}
            vazio="Nenhum reajuste registrado nos últimos 12 meses."
          />

          <SecaoRelatorio
            titulo="Pausadas e canceladas"
            explicacao={RELATORIO_ASSINATURAS_EXPLICACOES.inativas}
            Icon={PauseCircle}
            corIcone="text-gray-500"
            corFundo="bg-gray-100"
            colunas={['Assinatura', 'Categoria', 'Responsável', 'Deixou de sair']}
            linhas={relatorio.inativas.map(a => [a.nome, a.categoria, a.responsavel, a.valorMensal])}
            totais={[{ label: 'Economia mensal', valor: relatorio.economiaPausadas }]}
            vazio="Nenhuma assinatura pausada ou cancelada."
          />

          <p className="text-xs text-gray-400 leading-snug px-1 pb-1">
            Valores e pausas são reconstruídos pelo histórico de cada assinatura, então meses passados mantêm o
            valor que valia à época. Assinaturas cobradas no cartão também aparecem nas compras da fatura — não
            some as duas coisas.
          </p>
        </>
      )}
    </RelatorioShell>
  )
}
