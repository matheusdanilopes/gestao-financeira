/**
 * Análise de comportamento → DocumentoRelatorio, para sair em PDF e Markdown
 * com o mesmo exportador dos relatórios.
 */

import { formatBRL } from '@/lib/format'
import { formatarMes } from '@/lib/relatoriosFormat'
import type { DocumentoRelatorio } from '@/lib/relatorioDocumento'
import type { ResultadoAnalise } from './tipos'
import { OBJETIVOS_ANALISE, PESOS_SAUDE, rotuloJanela } from './tipos'

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
  const indicadores = m.saude.indicadores.map(i => ({ ...i, peso: PESOS_SAUDE[i.chave] ?? 0 }))
  const pesoSaude = indicadores.reduce((s, i) => s + i.peso, 0)
  const pontosSaude = indicadores.reduce((s, i) => s + i.nota * i.peso, 0)

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
        titulo: 'O que forma a nota',
        explicacao: `Nota calculada pelo app, não pela IA: cada indicador vale 100 no ideal e cai até 0 conforme se afasta dele; a nota geral é a média ponderada pelos pesos (${pontosSaude} ÷ ${pesoSaude}).`,
        colunas: ['Indicador', 'Medida', 'Ideal', 'Nota', 'Peso'],
        linhas: indicadores.map(i => [i.nome, i.medida, i.referencia, String(i.nota), String(i.peso)]),
      },
      ...(m.mesFoco && m.mesFoco.saldo && m.mesFoco.receita
        ? [{
            titulo: `${rotuloMesIso(m.mesFoco.mes)}: o saldo do mês`,
            explicacao: `Das faturas, ${formatBRL(m.mesFoco.parcelasEmAndamento.valor.atual)} são parcelas de compras antigas.`,
            colunas: ['Item', 'No mês', `Normal (média de ${m.mesFoco.mesesBase} meses)`],
            linhas: [
              ['Receita', m.mesFoco.receita.atual, m.mesFoco.receita.base],
              ['Faturas do cartão', -m.mesFoco.faturas.atual, -m.mesFoco.faturas.base],
              ['Contas', -m.mesFoco.contas.atual, -m.mesFoco.contas.base],
              ['Saldo', m.mesFoco.saldo.atual, m.mesFoco.saldo.base],
            ] as Array<[string, number, number]>,
          }]
        : []),
      {
        titulo: 'Seus números mês a mês',
        explicacao: 'Mesma conta do Dashboard: cartão = valor pago da fatura (sem pagamento marcado, a soma das compras); contas = despesas do planejamento; saldo = receita − cartão − contas. O mês atual fica fora das médias.',
        colunas: ['Mês', 'Receita', 'Cartão', 'Contas', 'Saldo', 'Poupança'],
        linhas: m.mensal.map(x => [
          `${rotuloMesIso(x.mes)}${x.parcial ? ' (parcial)' : ''}`,
          x.receita, x.gastoCartao, x.contas, x.saldo,
          x.taxaPoupanca === null ? '—' : `${x.taxaPoupanca.toLocaleString('pt-BR')}%`,
        ]),
      },
      ...(m.proximoMes
        ? [{
            titulo: `${rotuloMesIso(m.proximoMes.mes)}: quanto vai sobrar`,
            explicacao: 'Receita menos o que já está comprometido; depois, o gasto de um mês típico em compras novas e extras.',
            colunas: ['Item', 'Valor'],
            linhas: [
              [`Receita (${m.proximoMes.receitaFonte === 'planejada' ? 'planejada' : 'média'})`, m.proximoMes.receita],
              [`Contas (${{ planejadas: 'lançadas', media: 'média das recorrentes', planejadas_e_media: 'lançadas + recorrentes' }[m.proximoMes.contasFonte]})`, -m.proximoMes.contas],
              ['Parcelas já contratadas', -m.proximoMes.parcelas],
              ['Assinaturas', -m.proximoMes.assinaturas],
              ['= Livre para o mês', m.proximoMes.margemLivre],
              ['Gasto típico em compras novas e extras', -m.proximoMes.variavelHabitual],
              ['= Sobra prevista (negativa = falta)', m.proximoMes.folga],
              ['Limite semanal para compras novas', m.proximoMes.tetoSemanal],
            ] as Array<[string, number]>,
          }]
        : []),
      {
        titulo: 'O que os dados mostram (leitura da IA)',
        colunas: ['Padrão', 'Número-chave', 'O que acontece', 'Impacto', 'Relevância'],
        linhas: a.padroes.map(x => [x.titulo, x.destaque ?? '', [x.descricao, x.evidencia].filter(Boolean).join(' '), IMPACTO[x.impacto], NIVEL[x.relevancia]]),
      },
      {
        titulo: 'Plano de ação',
        explicacao: 'Economias estimadas pela IA e limitadas pelo app ao gasto real de cada categoria.',
        colunas: ['Ação', 'Por quê', 'Dificuldade', 'Prazo', 'Economia/mês'],
        linhas: a.planoDeAcao.map(x => [x.acao, x.porque, DIFICULDADE[x.dificuldade], x.prazo, x.economiaMensal]),
        totais: [{ label: 'Economia mensal estimada', valor: economiaTotal }],
      },
      {
        titulo: 'Metas para acompanhar',
        colunas: ['Meta', 'Indicador', 'Alvo', 'Prazo'],
        linhas: a.metas.map(x => [x.meta, x.indicador, x.alvo, x.prazo]),
      },
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
              ['Diferença fatura paga × compras (estornos, juros)', 'Variável', m.fixoVariavel.variavel.ajusteFatura ?? 0],
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
