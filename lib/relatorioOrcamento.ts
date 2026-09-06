/**
 * Previsto x realizado: onde o planejamento acerta, onde ele subestima e
 * quanto o mês costuma escorregar do orçamento.
 *
 * Metodologia: a comparação usa apenas lançamentos já pagos — comparar o
 * previsto de uma conta que ainda não foi paga contra "zero realizado" faria
 * todo mês em aberto parecer uma economia enorme. O que ainda não foi pago
 * aparece separado, como "em aberto".
 */
import { format, startOfMonth, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { buscarPaginado } from './supabasePaginado'
import { ehLinhaDeCartao, ehLinhaDeReceita, removerPrefixoCartao } from './tipoCartao'
import { formatBRL } from './format'
import { formatarMes, formatarPercentual, formatarVariacao } from './relatoriosFormat'
import type { DocumentoRelatorio } from './relatorioDocumento'
import type { Destaque } from '@/components/relatorios/DestaquesRelatorio'

export const JANELAS_ORCAMENTO = [3, 6, 12] as const
export type JanelaOrcamento = typeof JANELAS_ORCAMENTO[number]

/** Acima disso o mês conta como "estouro" daquele item. */
const TOLERANCIA_ESTOURO = 0.05

export const RELATORIO_ORCAMENTO_EXPLICACOES = {
  itens: 'Cada item do planejamento com o total previsto e o total efetivamente pago na janela. O desvio é pago menos previsto: positivo é estouro, negativo é economia.',
  categorias: 'O mesmo confronto, somado por categoria — mostra qual área do orçamento é sistematicamente mal dimensionada.',
  meses: 'Previsto e pago em cada mês da janela, com a aderência (pago dividido pelo previsto).',
  aberto: 'Lançamentos ainda não pagos na janela. Não entram na comparação porque não têm valor realizado.',
  metodologia: 'Só entram na comparação lançamentos já pagos. Contas em aberto ficam de fora para não virarem "economia" artificial.',
} as const

export interface LinhaOrcamento {
  chave: string
  categoria: string
  tipo: 'Cartão' | 'Conta'
  previsto: number
  realizado: number
  desvio: number
  desvioPct: number | null
  mesesPagos: number
  mesesEstourados: number
}

export interface MesOrcamento {
  mes: Date
  previsto: number
  realizado: number
  aderencia: number | null
  emAberto: number
}

export interface RelatorioOrcamento {
  meses: Date[]
  janela: JanelaOrcamento
  itens: LinhaOrcamento[]
  categorias: LinhaOrcamento[]
  porMes: MesOrcamento[]
  totalPrevisto: number
  totalRealizado: number
  totalEstourado: number
  totalEconomizado: number
  totalEmAberto: number
  erros: string[]
}

type PlanejamentoOrcamentoRow = {
  item: string
  categoria: string | null
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
  mes_referencia: string
}

function novaLinha(chave: string, categoria: string, tipo: 'Cartão' | 'Conta'): LinhaOrcamento {
  return {
    chave, categoria, tipo,
    previsto: 0, realizado: 0, desvio: 0, desvioPct: null,
    mesesPagos: 0, mesesEstourados: 0,
  }
}

function finalizar(linha: LinhaOrcamento): LinhaOrcamento {
  linha.desvio = linha.realizado - linha.previsto
  linha.desvioPct = linha.previsto > 0 ? (linha.desvio / linha.previsto) * 100 : null
  return linha
}

export async function buscarRelatorioOrcamento(
  janela: JanelaOrcamento,
  hoje: Date = new Date(),
): Promise<RelatorioOrcamento> {
  const erros: string[] = []
  const meses = Array.from({ length: janela }, (_, i) => startOfMonth(subMonths(hoje, janela - 1 - i)))
  const mesesStr = meses.map(m => format(m, 'yyyy-MM-dd'))

  const { data, error, truncado } = await buscarPaginado<PlanejamentoOrcamentoRow>((de, ate) =>
    supabase
      .from('planejamento')
      .select('item, categoria, valor_previsto, valor_real, pago, mes_referencia')
      .in('mes_referencia', mesesStr)
      .range(de, ate),
  )

  if (error) {
    console.error('[relatorioOrcamento] Falha ao buscar planejamento:', error)
    erros.push('Não foi possível carregar o planejamento do período.')
  }
  if (truncado) {
    erros.push('A janela tem lançamentos demais: a análise considera apenas os primeiros 20 mil.')
  }

  const porItem = new Map<string, LinhaOrcamento>()
  const porCategoria = new Map<string, LinhaOrcamento>()
  const porMes = new Map<string, MesOrcamento>()
  for (let i = 0; i < meses.length; i++) {
    porMes.set(mesesStr[i], { mes: meses[i], previsto: 0, realizado: 0, aderencia: null, emAberto: 0 })
  }

  let totalEmAberto = 0

  for (const row of data) {
    if (ehLinhaDeReceita(row.item)) continue

    const previsto = row.valor_previsto ?? 0
    const bucketMes = porMes.get(row.mes_referencia)

    if (!row.pago) {
      totalEmAberto += previsto
      if (bucketMes) bucketMes.emAberto += previsto
      continue
    }

    const realizado = row.valor_real ?? previsto
    const chave = removerPrefixoCartao(row.item) || row.item
    const categoria = row.categoria || 'Sem categoria'
    const tipo: 'Cartão' | 'Conta' = ehLinhaDeCartao(row.item) ? 'Cartão' : 'Conta'

    const item = porItem.get(chave) ?? novaLinha(chave, categoria, tipo)
    item.previsto += previsto
    item.realizado += realizado
    item.mesesPagos += 1
    if (previsto > 0 && realizado > previsto * (1 + TOLERANCIA_ESTOURO)) item.mesesEstourados += 1
    porItem.set(chave, item)

    const cat = porCategoria.get(categoria) ?? novaLinha(categoria, categoria, tipo)
    cat.previsto += previsto
    cat.realizado += realizado
    cat.mesesPagos += 1
    if (previsto > 0 && realizado > previsto * (1 + TOLERANCIA_ESTOURO)) cat.mesesEstourados += 1
    porCategoria.set(categoria, cat)

    if (bucketMes) {
      bucketMes.previsto += previsto
      bucketMes.realizado += realizado
    }
  }

  const itens = [...porItem.values()].map(finalizar).sort((a, b) => b.desvio - a.desvio)
  const categorias = [...porCategoria.values()].map(finalizar).sort((a, b) => b.desvio - a.desvio)
  const listaMeses = [...porMes.values()].map(m => ({
    ...m,
    aderencia: m.previsto > 0 ? (m.realizado / m.previsto) * 100 : null,
  }))

  return {
    meses,
    janela,
    itens,
    categorias,
    porMes: listaMeses,
    totalPrevisto: itens.reduce((acc, i) => acc + i.previsto, 0),
    totalRealizado: itens.reduce((acc, i) => acc + i.realizado, 0),
    totalEstourado: itens.filter(i => i.desvio > 0).reduce((acc, i) => acc + i.desvio, 0),
    totalEconomizado: itens.filter(i => i.desvio < 0).reduce((acc, i) => acc + Math.abs(i.desvio), 0),
    totalEmAberto,
    erros,
  }
}

// ── Leituras (puras) ───────────────────────────────────────────────────────

export interface IndicadoresOrcamento {
  aderencia: number | null
  desvioTotal: number
  itensEstourados: number
  itensCronicos: LinhaOrcamento[]
  mesMaisPreciso: MesOrcamento | null
  mesMenosPreciso: MesOrcamento | null
}

export function indicadoresOrcamento(relatorio: RelatorioOrcamento): IndicadoresOrcamento {
  const comAderencia = relatorio.porMes.filter(m => m.aderencia !== null)

  return {
    aderencia: relatorio.totalPrevisto > 0
      ? (relatorio.totalRealizado / relatorio.totalPrevisto) * 100
      : null,
    desvioTotal: relatorio.totalRealizado - relatorio.totalPrevisto,
    itensEstourados: relatorio.itens.filter(i => i.desvio > 0).length,
    // "Crônico" = estourou na maioria dos meses em que foi pago, com pelo
    // menos dois meses de histórico. Um estouro isolado é ruído.
    itensCronicos: relatorio.itens
      .filter(i => i.mesesPagos >= 2 && i.mesesEstourados >= Math.ceil(i.mesesPagos / 2) && i.desvio > 0)
      .sort((a, b) => b.desvio - a.desvio),
    mesMaisPreciso: comAderencia.length > 0
      ? comAderencia.reduce((melhor, m) =>
          Math.abs((m.aderencia ?? 100) - 100) < Math.abs((melhor.aderencia ?? 100) - 100) ? m : melhor,
        comAderencia[0])
      : null,
    mesMenosPreciso: comAderencia.length > 0
      ? comAderencia.reduce((pior, m) =>
          Math.abs((m.aderencia ?? 100) - 100) > Math.abs((pior.aderencia ?? 100) - 100) ? m : pior,
        comAderencia[0])
      : null,
  }
}

export function montarDestaquesOrcamento(relatorio: RelatorioOrcamento): Destaque[] {
  const ind = indicadoresOrcamento(relatorio)
  const destaques: Destaque[] = []

  if (relatorio.totalPrevisto === 0) return destaques

  if (ind.aderencia !== null) {
    const desvio = ind.aderencia - 100
    destaques.push({
      tom: Math.abs(desvio) <= 5 ? 'positivo' : desvio > 0 ? 'atencao' : 'neutro',
      titulo: `Você pagou ${formatarPercentual(ind.aderencia, 1)} do que planejou`,
      detalhe: `${formatBRL(relatorio.totalRealizado)} pagos contra ${formatBRL(relatorio.totalPrevisto)} previstos — ${desvio >= 0 ? 'estouro' : 'economia'} de ${formatBRL(Math.abs(ind.desvioTotal))} em ${relatorio.janela} meses.`,
    })
  }

  const maiorEstouro = relatorio.itens[0]
  if (maiorEstouro && maiorEstouro.desvio > 0) {
    destaques.push({
      tom: 'negativo',
      titulo: `Maior estouro: ${maiorEstouro.chave} (+${formatBRL(maiorEstouro.desvio)})`,
      detalhe: `Previsto ${formatBRL(maiorEstouro.previsto)} · pago ${formatBRL(maiorEstouro.realizado)} em ${maiorEstouro.mesesPagos} mês(es).`,
    })
  }

  if (ind.itensCronicos.length > 0) {
    destaques.push({
      tom: 'atencao',
      titulo: `${ind.itensCronicos.length} item(ns) estouram quase todo mês`,
      detalhe: `${ind.itensCronicos.slice(0, 3).map(i => i.chave).join(', ')} — vale revisar o valor previsto em vez de brigar com o resultado.`,
    })
  }

  const maiorEconomia = [...relatorio.itens].reverse()[0]
  if (maiorEconomia && maiorEconomia.desvio < 0) {
    destaques.push({
      tom: 'positivo',
      titulo: `Maior economia: ${maiorEconomia.chave} (${formatBRL(Math.abs(maiorEconomia.desvio))} abaixo do previsto)`,
      detalhe: `Previsto ${formatBRL(maiorEconomia.previsto)} · pago ${formatBRL(maiorEconomia.realizado)}.`,
    })
  }

  if (ind.mesMenosPreciso && ind.mesMenosPreciso.aderencia !== null) {
    destaques.push({
      tom: 'neutro',
      titulo: `Mês menos previsível: ${formatarMes(ind.mesMenosPreciso.mes)} (${formatarPercentual(ind.mesMenosPreciso.aderencia, 0)} do previsto)`,
      detalhe: ind.mesMaisPreciso && ind.mesMaisPreciso.aderencia !== null
        ? `O mais certeiro foi ${formatarMes(ind.mesMaisPreciso.mes)}, com ${formatarPercentual(ind.mesMaisPreciso.aderencia, 0)}.`
        : undefined,
    })
  }

  if (relatorio.totalEmAberto > 0) {
    destaques.push({
      tom: 'atencao',
      titulo: `${formatBRL(relatorio.totalEmAberto)} previstos ainda em aberto na janela`,
      detalhe: 'Esses lançamentos ficam fora da comparação até serem pagos.',
    })
  }

  return destaques
}

// ── Documento exportado ────────────────────────────────────────────────────

export function montarDocumentoOrcamento(relatorio: RelatorioOrcamento): DocumentoRelatorio {
  const ind = indicadoresOrcamento(relatorio)
  const primeiro = relatorio.meses[0]
  const ultimo = relatorio.meses[relatorio.meses.length - 1]

  return {
    titulo: 'Orçamento: Previsto x Realizado',
    subtitulo: `${formatarMes(primeiro)} a ${formatarMes(ultimo)} (${relatorio.janela} meses)`,
    nomeArquivo: `relatorio-orcamento-${format(ultimo, 'yyyy-MM')}-${relatorio.janela}m`,
    avisos: relatorio.erros,
    corCabecalho: [180, 83, 9],
    resumo: [
      { label: 'Previsto (pago)', valor: relatorio.totalPrevisto },
      { label: 'Realizado', valor: relatorio.totalRealizado },
      { label: 'Aderência', valor: ind.aderencia === null ? '—' : formatarPercentual(ind.aderencia, 1) },
      { label: 'Estouros', valor: relatorio.totalEstourado },
      { label: 'Economias', valor: relatorio.totalEconomizado },
      { label: 'Em aberto', valor: relatorio.totalEmAberto },
    ],
    secoes: [
      {
        titulo: 'Aderência mês a mês',
        explicacao: RELATORIO_ORCAMENTO_EXPLICACOES.meses,
        colunas: ['Mês', 'Previsto', 'Pago', 'Desvio', 'Aderência', 'Em aberto'],
        linhas: relatorio.porMes.map(m => [
          formatarMes(m.mes), m.previsto, m.realizado, m.realizado - m.previsto,
          m.aderencia === null ? '—' : formatarPercentual(m.aderencia, 1),
          m.emAberto,
        ]),
        totais: [
          { label: 'Previsto', valor: relatorio.totalPrevisto },
          { label: 'Pago', valor: relatorio.totalRealizado },
        ],
      },
      {
        titulo: 'Desvios por categoria',
        explicacao: RELATORIO_ORCAMENTO_EXPLICACOES.categorias,
        colunas: ['Categoria', 'Meses', 'Previsto', 'Pago', 'Desvio', 'Desvio %'],
        linhas: relatorio.categorias.map(c => [
          c.chave, String(c.mesesPagos), c.previsto, c.realizado, c.desvio, formatarVariacao(c.desvioPct),
        ]),
      },
      {
        titulo: 'Desvios por item',
        explicacao: RELATORIO_ORCAMENTO_EXPLICACOES.itens,
        colunas: ['Item', 'Categoria', 'Tipo', 'Meses', 'Estouros', 'Previsto', 'Pago', 'Desvio', 'Desvio %'],
        linhas: relatorio.itens.map(i => [
          i.chave, i.categoria, i.tipo, String(i.mesesPagos), String(i.mesesEstourados),
          i.previsto, i.realizado, i.desvio, formatarVariacao(i.desvioPct),
        ]),
        totais: [
          { label: 'Estouros', valor: relatorio.totalEstourado },
          { label: 'Economias', valor: relatorio.totalEconomizado },
        ],
      },
      {
        titulo: 'Itens que estouram cronicamente',
        colunas: ['Item', 'Meses pagos', 'Meses estourados', 'Previsto', 'Pago', 'Desvio'],
        linhas: ind.itensCronicos.map(i => [
          i.chave, String(i.mesesPagos), String(i.mesesEstourados), i.previsto, i.realizado, i.desvio,
        ]),
        vazio: 'Nenhum item estourou de forma recorrente.',
      },
      {
        titulo: 'Destaques',
        colunas: ['Leitura'],
        linhas: montarDestaquesOrcamento(relatorio).map(d => [
          d.detalhe ? `${d.titulo} — ${d.detalhe}` : d.titulo,
        ]),
        vazio: 'Sem lançamentos pagos na janela.',
      },
    ],
    notaRodape: RELATORIO_ORCAMENTO_EXPLICACOES.metodologia,
  }
}
