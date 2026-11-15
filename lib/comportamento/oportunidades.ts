/**
 * Oportunidades de economia calculadas pelo app, não pela IA.
 *
 * Antes, cada dica do plano de ação trazia uma "economia estimada" escrita
 * pela IA — e a conta raramente era conferível (cortar metade de quê? de qual
 * média?). Agora o app lista as oportunidades que os números sustentam, cada
 * uma com a economia e a regra da conta; o Fin escolhe quais viram dica e
 * explica, mas o valor em reais sai daqui. Dica sem oportunidade não promete
 * economia.
 *
 * As regras são deliberadamente conservadoras: o objetivo é uma promessa que
 * a pessoa consiga cumprir e conferir, não o maior número possível.
 */

import type { MetricasComportamento } from './tipos'

export type TipoOportunidade =
  | 'categoria_em_alta' | 'microgastos' | 'lugar_frequente' | 'assinaturas' | 'conta_estoura'
  | 'assinatura_pausada_cobrada' | 'cobranca_recorrente'

export interface Oportunidade {
  /** Identificador estável que a IA devolve na dica ("categoria:Delivery"). */
  id: string
  tipo: TipoOportunidade
  /** O que fazer, em linguagem simples. */
  titulo: string
  /** Categoria de onde sai a economia (para não contar o mesmo gasto duas vezes). */
  categoria: string
  economiaMensal: number
  /** A conta, em português, para o "Como calculei". */
  regra: string
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const reais = (v: number) => BRL.format(Math.round(v)).replace(/\s/g, ' ')
const arred = (v: number) => Math.max(0, Math.floor(v))

/** Economia mínima para valer uma dica: abaixo disso é ruído. */
const MINIMO = 20

/**
 * Maior compra nova de cada categoria na fatura em foco, pelo valor cheio
 * (parcela × total, como nas métricas do mês).
 */
function maiorCompraNovaPorCategoria(m: MetricasComportamento): Map<string, number> {
  const maior = new Map<string, number>()
  for (const l of m.mesFoco?.lancamentos ?? []) {
    if (l.tipo !== 'compra_nova') continue
    const total = Number(l.parcela?.split('/')[1]) || 1
    const cheio = l.valor * total
    if (cheio > (maior.get(l.categoria) ?? 0)) maior.set(l.categoria, cheio)
  }
  return maior
}

export function calcularOportunidades(m: MetricasComportamento): Oportunidade[] {
  const ops: Oportunidade[] = []
  const categoriasUsadas = new Set<string>()

  // 1. Categorias que subiram em relação ao normal: voltar ao normal.
  if (m.mesFoco) {
    const base = m.mesFoco.mesesBase
    const maiorCompra = maiorCompraNovaPorCategoria(m)
    for (const c of [...m.mesFoco.categorias]
      .filter(c => c.categoria !== 'Sem categoria' && c.base > 0 && c.atual - c.base >= 50 && (c.variacaoPct ?? 0) >= 20)
      // Uma compra só (ex.: 8× na oficina, pelo valor cheio) não é hábito:
      // prometer essa diferença como economia por mês seria falso.
      .filter(c => (maiorCompra.get(c.categoria) ?? 0) < (c.atual - c.base) * 0.5)
      .sort((a, b) => (b.atual - b.base) - (a.atual - a.base))
      .slice(0, 3)) {
      const economia = arred(c.atual - c.base)
      categoriasUsadas.add(c.categoria)
      ops.push({
        id: `categoria:${c.categoria}`,
        tipo: 'categoria_em_alta',
        titulo: `Voltar ${c.categoria} ao normal`,
        categoria: c.categoria,
        economiaMensal: economia,
        regra: `Compras novas em ${c.categoria} nesta fatura (${reais(c.atual)}) − média das ${base} faturas anteriores (${reais(c.base)}) = ${reais(economia)}.`,
      })
    }
  } else {
    for (const c of m.categorias
      .filter(c => c.categoria !== 'Sem categoria' && c.variacaoPct !== null && c.variacaoPct >= 15 && c.mediaRecente - c.mediaAnterior >= 50)
      .sort((a, b) => (b.mediaRecente - b.mediaAnterior) - (a.mediaRecente - a.mediaAnterior))
      .slice(0, 3)) {
      const economia = arred(c.mediaRecente - c.mediaAnterior)
      categoriasUsadas.add(c.categoria)
      ops.push({
        id: `categoria:${c.categoria}`,
        tipo: 'categoria_em_alta',
        titulo: `Voltar ${c.categoria} ao normal`,
        categoria: c.categoria,
        economiaMensal: economia,
        regra: `Média dos últimos 3 meses em ${c.categoria} (${reais(c.mediaRecente)}) − média dos meses anteriores (${reais(c.mediaAnterior)}) = ${reais(economia)} por mês.`,
      })
    }
  }

  // 2. Microgastos (efeito formiga): cortar 1 em cada 3.
  const micro = m.ticket.microgastos
  const minimoCompras = m.mesFoco ? 6 : 8
  if (micro.quantidade >= minimoCompras && micro.mediaMensal / 3 >= MINIMO) {
    const economia = arred(micro.mediaMensal / 3)
    ops.push({
      id: 'microgastos',
      tipo: 'microgastos',
      titulo: `Cortar 1 em cada 3 compras de até ${reais(micro.limite)}`,
      categoria: '',
      economiaMensal: economia,
      regra: `Compras pequenas (até ${reais(micro.limite)}) somam ${reais(micro.mediaMensal)} por mês; um terço disso = ${reais(economia)}.`,
    })
  }

  // 3. Lugares onde a pessoa volta muito: uma visita a menos em cada quatro.
  // O mês parcial também tem compras: dividir pelos fechados + 1 subestima um
  // pouco a média — de propósito.
  const meses = m.mesFoco ? 1 : m.periodo.mesesFechados + 1
  for (const e of m.estabelecimentos
    .filter(e => !categoriasUsadas.has(e.categoria) && e.quantidade / meses >= 4)
    .map(e => ({ e, porMes: e.total / meses }))
    .filter(x => x.porMes / 4 >= MINIMO)
    .sort((a, b) => b.porMes - a.porMes)
    .slice(0, 2)) {
    const economia = arred(e.porMes / 4)
    const vezes = Math.round(e.e.quantidade / meses)
    ops.push({
      id: `lugar:${e.e.nome}`,
      tipo: 'lugar_frequente',
      titulo: `Ir menos a ${e.e.nome}`,
      categoria: e.e.categoria,
      economiaMensal: economia,
      regra: `${e.e.nome}: cerca de ${vezes} compras e ${reais(e.porMes)} por mês; uma visita a menos em cada quatro = ${reais(economia)}.`,
    })
  }

  // 4. Assinaturas: cancelar uma (a estimativa é a mais barata — a promessa
  // mínima, já que o app não sabe qual delas é pouco usada).
  const assin = m.assinaturas
  if (assin.ativas >= 2 && assin.maiores.length > 0) {
    const maisBarata = [...assin.maiores].sort((a, b) => a.valor - b.valor)[0]
    if (maisBarata.valor >= 10) {
      const economia = arred(maisBarata.valor)
      ops.push({
        id: 'assinaturas',
        tipo: 'assinaturas',
        titulo: 'Cancelar uma assinatura pouco usada',
        categoria: maisBarata.categoria,
        economiaMensal: economia,
        regra: `${assin.ativas} assinaturas ativas (${reais(assin.custoMensal)} por mês). Estimativa mínima: cancelar a mais barata, ${maisBarata.nome} (${reais(economia)}).`,
      })
    }
  }

  // 4b. Do banco: assinatura pausada/inativa no app que continua sendo cobrada.
  // A economia é a cobrança inteira — é dinheiro que não deveria sair.
  for (const a of (m.sinais?.cobrancasRecorrentes.pausadasCobradas ?? []).filter(a => a.valor >= MINIMO).slice(0, 2)) {
    ops.push({
      id: `pausada:${a.nome}`,
      tipo: 'assinatura_pausada_cobrada',
      titulo: `Confirmar o cancelamento de ${a.nome}`,
      categoria: a.categoria,
      economiaMensal: arred(a.valor),
      regra: `${a.nome} está pausada ou inativa no app, mas foi cobrada ${reais(a.valor)} em ${a.ultimaCobranca.split('-').reverse().join('/')}.`,
    })
  }

  // 4c. Do banco: cobrança mensal que não está nas assinaturas. A promessa é
  // a cobrança, se a pessoa não usa o serviço — por isso só as duas maiores.
  for (const r of (m.sinais?.cobrancasRecorrentes.naoCadastradas ?? []).filter(r => r.valor >= MINIMO).slice(0, 2)) {
    ops.push({
      id: `recorrente:${r.descricao}`,
      tipo: 'cobranca_recorrente',
      titulo: `Revisar a cobrança mensal de ${r.descricao}`,
      categoria: r.categoria,
      economiaMensal: arred(r.valor),
      regra: `${r.descricao} cobra ${reais(r.valor)} todo mês (${r.faturas} faturas seguidas) e não está nas assinaturas do app. Se não usa, cancelar = ${reais(r.valor)} por mês.`,
    })
  }

  // 5. Contas que passam do previsto quase todo mês: voltar ao previsto.
  for (const i of m.planejamento.itensQueEstouram.filter(i => i.excessoMedio >= MINIMO).slice(0, 2)) {
    const economia = arred(i.excessoMedio)
    ops.push({
      id: `conta:${i.item}`,
      tipo: 'conta_estoura',
      titulo: `Trazer ${i.item} de volta ao previsto`,
      categoria: i.categoria,
      economiaMensal: economia,
      regra: `${i.item} passou do previsto em ${i.mesesEstourados} de ${i.mesesAvaliados} meses, em média ${reais(economia)} a mais.`,
    })
  }

  return ops.sort((a, b) => b.economiaMensal - a.economiaMensal)
}

/** Texto das oportunidades para o pedido ao modelo (também serve de evidência). */
export function oportunidadesParaPrompt(ops: Oportunidade[]): string {
  if (ops.length === 0) return 'OPORTUNIDADES DE ECONOMIA (calculadas pelo app): nenhuma com base suficiente nos dados.'
  return [
    'OPORTUNIDADES DE ECONOMIA (calculadas pelo app — use o id na dica; o valor é o do app):',
    'id|o que fazer|categoria|economia por mês|economia por ano|conta',
    ...ops.map(o => [o.id, o.titulo, o.categoria, o.economiaMensal.toFixed(2), (o.economiaMensal * 12).toFixed(2), o.regra].join('|')),
  ].join('\n')
}
