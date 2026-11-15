/**
 * Conferência da Análise do Fin: todo valor em R$ que o texto cita precisa
 * existir nos números que o app calculou.
 *
 * Usa o mesmo "lastro" do chat (lib/ai/agent/lastro). A evidência é o JSON
 * das métricas, a tabela de lançamentos, as oportunidades de economia e um
 * punhado de contas simples que o Fin pode fazer ao explicar (diferença entre
 * o mês e o normal, valor anual de um gasto mensal). Um valor fora disso é
 * tratado como inventado: o item que o cita sai da análise.
 */

import { indexarEvidencias, verificarLastro, type IndiceEvidencias } from '@/lib/ai/agent/lastro'
import type { AnaliseIA, MetricasComportamento } from './tipos'
import { oportunidadesParaPrompt, type Oportunidade } from './oportunidades'

/** Contas derivadas legítimas, que não aparecem prontas no JSON. */
function valoresDerivados(m: MetricasComportamento, ops: Oportunidade[]): number[] {
  const v: number[] = []
  const anual = (x: number) => v.push(x, x * 12)
  for (const c of m.categorias) {
    v.push(c.mediaRecente - c.mediaAnterior)
    anual(c.mediaMensal)
  }
  if (m.mesFoco) {
    const f = m.mesFoco
    const comps = [
      f.compras.valor, f.compras.ticketMedio, f.parcelasEmAndamento.valor, f.faturas, f.contas, f.microgastos.valor,
      f.novosParcelamentos.valorFinanciado, ...(f.receita ? [f.receita] : []), ...(f.saldo ? [f.saldo] : []), ...f.categorias,
    ]
    for (const c of comps) v.push(c.atual - c.base)
  }
  for (const x of m.mensal) v.push(x.saldo)
  anual(m.resumo.gastoMedio)
  anual(m.resumo.saldoMedio)
  anual(m.ticket.microgastos.mediaMensal)
  anual(m.assinaturas.custoMensal)
  if (m.fixoVariavel) { anual(m.fixoVariavel.fixo.total); anual(m.fixoVariavel.variavel.total) }
  if (m.proximoMes) { v.push(m.proximoMes.folga, m.proximoMes.margemLivre, m.proximoMes.tetoSemanal) }
  for (const o of ops) anual(o.economiaMensal)
  // A soma das dicas escolhidas entra depois (indexarComPlano).
  return v.filter(Number.isFinite)
}

const numeros = (xs: number[]) => xs.map(x => (Math.round(Math.abs(x) * 100) / 100).toFixed(2)).join(' ')

export function indexarEvidenciasAnalise(
  m: MetricasComportamento,
  ops: Oportunidade[],
  extras: string[] = [],
): IndiceEvidencias {
  return indexarEvidencias([
    JSON.stringify(m),
    oportunidadesParaPrompt(ops),
    numeros(valoresDerivados(m, ops)),
    ...extras,
  ])
}

/** A soma das economias das dicas escolhidas (e o valor anual) também vale. */
export function evidenciaDoPlano(a: AnaliseIA): string {
  const total = a.planoDeAcao.reduce((s, p) => s + p.economiaMensal, 0)
  return numeros([total, total * 12, ...a.planoDeAcao.map(p => p.economiaMensal * 12)])
}

/** Textos da análise que podem citar valores, com o caminho de cada um. */
function textos(a: AnaliseIA): string {
  return [
    a.manchete, a.resumo, a.perfil.descricao,
    ...a.padroes.flatMap(p => [p.titulo, p.destaque, p.descricao]),
    ...a.gatilhos.flatMap(g => [g.titulo, g.descricao]),
    ...a.pontosFortes.flatMap(g => [g.titulo, g.descricao]),
    ...a.riscos.flatMap(g => [g.titulo, g.descricao]),
    ...a.planoDeAcao.flatMap(p => [p.acao, p.porque]),
    ...a.metas.flatMap(x => [x.meta, x.indicador, x.alvo]),
    ...a.perguntas,
  ].join('\n')
}

export function valoresSemLastro(a: AnaliseIA, idx: IndiceEvidencias): { citados: number; semLastro: string[] } {
  return verificarLastro(textos(a), idx)
}

/**
 * Tira da análise o que cita valor sem origem: itens de lista saem inteiros;
 * em textos corridos (manchete, resumo, perfil) sai só a frase.
 */
export function removerSemLastro(a: AnaliseIA, idx: IndiceEvidencias): AnaliseIA {
  const ok = (...t: string[]) => verificarLastro(t.join('\n'), idx).semLastro.length === 0
  // Corta só em pontuação seguida de espaço: "R$ 4.321,99" não é fim de frase.
  const frases = (t: string) => t.split(/(?<=[.!?…])\s+/).filter(f => ok(f)).join(' ').trim()

  const padroes = a.padroes.filter(p => ok(p.titulo, p.destaque, p.descricao))
  const plano = a.planoDeAcao.map(p => (ok(p.acao, p.porque) ? p : { ...p, porque: frases(p.porque) }))
  const manchete = frases(a.manchete) || padroes[0]?.titulo || ''
  return {
    ...a,
    manchete,
    resumo: frases(a.resumo),
    perfil: { ...a.perfil, descricao: frases(a.perfil.descricao) },
    padroes,
    gatilhos: a.gatilhos.filter(g => ok(g.titulo, g.descricao)),
    pontosFortes: a.pontosFortes.filter(g => ok(g.titulo, g.descricao)),
    riscos: a.riscos.filter(g => ok(g.titulo, g.descricao)),
    planoDeAcao: plano.filter(p => ok(p.acao)),
    metas: a.metas.filter(x => ok(x.meta, x.indicador, x.alvo)),
    perguntas: a.perguntas.filter(q => ok(q)),
  }
}
