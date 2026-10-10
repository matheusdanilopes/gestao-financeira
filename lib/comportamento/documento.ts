/**
 * Análise de comportamento → DocumentoRelatorio, para sair em PDF e Markdown
 * com o mesmo exportador dos relatórios.
 */

import { formatarMes } from '@/lib/relatoriosFormat'
import type { DocumentoRelatorio } from '@/lib/relatorioDocumento'
import type { ResultadoAnalise } from './tipos'
import { OBJETIVOS_ANALISE } from './tipos'

const NIVEL: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }
const DIFICULDADE: Record<string, string> = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' }
const IMPACTO: Record<string, string> = { positivo: 'Positivo', negativo: 'Negativo', neutro: 'Neutro' }

export function rotuloMesIso(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return formatarMes(new Date(a, m - 1, 1))
}

export function rotuloEscopo(escopo: string): string {
  return escopo === 'casal' ? 'Casal' : escopo
}

export function montarDocumentoAnalise(r: ResultadoAnalise): DocumentoRelatorio {
  const { analise: a, metricas: m, parametros: p } = r
  const objetivo = OBJETIVOS_ANALISE.find(o => o.chave === p.objetivo)?.label ?? p.objetivo
  const economiaTotal = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)

  return {
    titulo: 'Análise de Comportamento Financeiro',
    subtitulo: `${rotuloMesIso(m.periodo.inicio)} a ${rotuloMesIso(m.periodo.fim)} · ${rotuloEscopo(p.escopo)} · objetivo: ${objetivo}`,
    nomeArquivo: `analise-comportamento-${r.geradaEm.substring(0, 10)}`,
    corCabecalho: [124, 58, 237],
    resumo: [
      { label: 'Nota de saúde', valor: `${m.saude.nota}/100` },
      { label: 'Perfil', valor: a.perfil.nome },
      { label: 'Gasto médio mensal', valor: m.resumo.gastoMedio },
      { label: 'Economia potencial/mês', valor: economiaTotal },
    ],
    avisos: m.qualidade.avisos,
    secoes: [
      {
        titulo: 'Diagnóstico',
        colunas: ['Leitura do analista'],
        linhas: [[a.manchete], ...a.resumo.split(/\n\s*\n/).filter(Boolean).map(par => [par.trim()]), [`Perfil — ${a.perfil.nome}: ${a.perfil.descricao}`]],
      },
      {
        titulo: 'Indicadores de saúde',
        explicacao: 'Nota 0–100 por regra fixa; a nota geral é a média ponderada.',
        colunas: ['Indicador', 'Medida', 'Referência', 'Nota'],
        linhas: m.saude.indicadores.map(i => [i.nome, i.medida, i.referencia, String(i.nota)]),
      },
      {
        titulo: 'Padrões identificados',
        colunas: ['Padrão', 'O que acontece', 'Evidência', 'Impacto', 'Relevância'],
        linhas: a.padroes.map(x => [x.titulo, x.descricao, x.evidencia, IMPACTO[x.impacto], NIVEL[x.relevancia]]),
      },
      {
        titulo: 'Gatilhos de gasto',
        colunas: ['Gatilho', 'Como age', 'Evidência'],
        linhas: a.gatilhos.map(x => [x.titulo, x.descricao, x.evidencia]),
      },
      {
        titulo: 'Pontos fortes',
        colunas: ['Ponto forte', 'Por quê'],
        linhas: a.pontosFortes.map(x => [x.titulo, x.descricao]),
      },
      {
        titulo: 'Riscos',
        colunas: ['Risco', 'Descrição', 'Probabilidade'],
        linhas: a.riscos.map(x => [x.titulo, x.descricao, NIVEL[x.probabilidade]]),
      },
      {
        titulo: 'Plano de ação',
        colunas: ['Ação', 'Por quê', 'Dificuldade', 'Prazo', 'Economia/mês'],
        linhas: a.planoDeAcao.map(x => [x.acao, x.porque, DIFICULDADE[x.dificuldade], x.prazo, x.economiaMensal]),
        totais: [{ label: 'Economia mensal estimada', valor: economiaTotal }],
      },
      {
        titulo: 'Metas sugeridas',
        colunas: ['Meta', 'Indicador', 'Alvo', 'Prazo'],
        linhas: a.metas.map(x => [x.meta, x.indicador, x.alvo, x.prazo]),
      },
      {
        titulo: 'Série mensal',
        colunas: ['Mês', 'Receita', 'Gasto total', 'Saldo', 'Poupança', 'Aportes'],
        linhas: m.mensal.map(x => [
          `${rotuloMesIso(x.mes)}${x.parcial ? ' (parcial)' : ''}`,
          x.receita, x.gastoTotal, x.saldo,
          x.taxaPoupanca === null ? '—' : `${x.taxaPoupanca.toLocaleString('pt-BR')}%`,
          x.aportes,
        ]),
      },
      {
        titulo: 'Para refletir',
        colunas: ['Pergunta'],
        linhas: a.perguntas.map(q => [q]),
      },
    ],
    notaRodape: [
      'Métricas calculadas pelo app; a interpretação foi gerada por IA a partir delas.',
      ...a.limitacoes.map(l => `Limitação: ${l}`),
    ].join(' '),
  }
}
