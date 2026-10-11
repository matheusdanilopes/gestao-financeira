/**
 * Análise de comportamento → DocumentoRelatorio, para sair em PDF e Markdown
 * com o mesmo exportador dos relatórios.
 */

import { formatarMes } from '@/lib/relatoriosFormat'
import type { DocumentoRelatorio } from '@/lib/relatorioDocumento'
import type { ResultadoAnalise } from './tipos'
import { OBJETIVOS_ANALISE, rotuloJanela } from './tipos'

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
    subtitulo: m.mesFoco
      ? `${rotuloJanela(p.janela)}: ${rotuloMesIso(m.mesFoco.mes)} vs. ${m.mesFoco.mesesBase} meses anteriores · ${rotuloEscopo(p.escopo)} · objetivo: ${objetivo}`
      : `${rotuloMesIso(m.periodo.inicio)} a ${rotuloMesIso(m.periodo.fim)} · ${rotuloEscopo(p.escopo)} · objetivo: ${objetivo}`,
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
      ...(m.proximoMes
        ? [{
            titulo: `${rotuloMesIso(m.proximoMes.mes)}: quanto sobra para decidir`,
            explicacao: 'Receita menos o que já está comprometido; a folga compara a margem livre com o gasto variável de um mês típico.',
            colunas: ['Item', 'Valor'],
            linhas: [
              [`Receita (${m.proximoMes.receitaFonte === 'planejada' ? 'planejada' : 'média'})`, m.proximoMes.receita],
              [`Contas (${{ planejadas: 'planejadas', media: 'recorrentes, média', planejadas_e_media: 'planejadas + recorrentes' }[m.proximoMes.contasFonte]})`, -m.proximoMes.contas],
              ['Parcelas já contratadas', -m.proximoMes.parcelas],
              ['Assinaturas', -m.proximoMes.assinaturas],
              ['Margem livre', m.proximoMes.margemLivre],
              ['Gasto variável habitual', m.proximoMes.variavelHabitual],
              ['Folga (negativa = falta)', m.proximoMes.folga],
              ['Teto semanal para compras novas', m.proximoMes.tetoSemanal],
            ] as Array<[string, number]>,
          }]
        : []),
      ...(m.fixoVariavel
        ? [{
            titulo: 'Fixo × variável (média mensal)',
            explicacao: `${m.fixoVariavel.pctFixo.toLocaleString('pt-BR')}% do gasto já vem comprometido.`,
            colunas: ['Parte', 'Tipo', 'Valor'],
            linhas: [
              ['Contas recorrentes', 'Fixo', m.fixoVariavel.fixo.contas],
              ['Parcelas de compras antigas', 'Fixo', m.fixoVariavel.fixo.parcelas],
              ['Assinaturas', 'Fixo', m.fixoVariavel.fixo.assinaturas],
              ['Compras novas no cartão', 'Variável', m.fixoVariavel.variavel.cartao],
              ['Fatura paga − compras (estornos, encargos)', 'Variável', m.fixoVariavel.variavel.ajusteFatura ?? 0],
              ['Contas fora da rotina', 'Variável', m.fixoVariavel.variavel.contas],
            ] as Array<[string, string, number]>,
          }]
        : []),
      {
        titulo: 'Contas que estouram o previsto',
        colunas: ['Conta', 'Meses acima do previsto', 'Excesso médio'],
        linhas: m.planejamento.itensQueEstouram.map(i => [i.item, `${i.mesesEstourados} de ${i.mesesAvaliados}`, i.excessoMedio]),
      },
      {
        titulo: 'Assinaturas ativas',
        colunas: ['Assinatura', 'Categoria', 'Valor/mês'],
        linhas: m.assinaturas.maiores.map(x => [x.nome, x.categoria, x.valor]),
        ...(m.assinaturas.ativas > 0 ? { totais: [{ label: `Total (${m.assinaturas.ativas} ativas)`, valor: m.assinaturas.custoMensal }] } : {}),
      },
      {
        titulo: 'Compras fora do padrão',
        colunas: ['Data', 'Descrição', 'Categoria', 'Vezes o normal', 'Valor'],
        linhas: m.comprasAtipicas.map(c => [
          (c.data ?? '').substring(0, 10).split('-').reverse().join('/'),
          c.descricao,
          c.categoria,
          `${c.vezesMediana.toLocaleString('pt-BR')}×`,
          c.valor,
        ]),
      },
      {
        titulo: 'Padrões identificados',
        colunas: ['Padrão', 'Número-chave', 'O que acontece', 'Impacto', 'Relevância'],
        linhas: a.padroes.map(x => [x.titulo, x.destaque ?? '', [x.descricao, x.evidencia].filter(Boolean).join(' '), IMPACTO[x.impacto], NIVEL[x.relevancia]]),
      },
      {
        titulo: 'Gatilhos de gasto',
        colunas: ['Gatilho', 'Como age'],
        linhas: a.gatilhos.map(x => [x.titulo, x.descricao]),
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
      ...(m.mesFoco
        ? [{
            titulo: `Lançamentos das faturas de ${rotuloMesIso(m.mesFoco.mes)}`,
            explicacao: 'Parcelas em andamento entram com a data de abertura da fatura — não são compras novas.',
            colunas: ['Data', 'Descrição', 'Categoria', 'Responsável', 'Tipo', 'Valor'],
            linhas: m.mesFoco.lancamentos.map(l => [
              l.data.split('-').reverse().join('/'),
              l.descricao,
              l.categoria,
              l.responsavel,
              l.tipo === 'compra_nova' ? (l.parcela ? `Compra nova (${l.parcela})` : 'Compra nova') : `Parcela ${l.parcela ?? ''}`.trim(),
              l.valor,
            ]),
          }]
        : []),
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
