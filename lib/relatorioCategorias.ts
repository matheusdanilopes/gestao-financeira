/**
 * Raio-X por categoria: quanto cada tema de gasto pesa, como ele se move mês a
 * mês e o que mudou em relação à própria média.
 *
 * Sobre a dupla contagem: a fatura do cartão aparece duas vezes na base — como
 * linha de `planejamento` (a quitação) e como as compras em `transacoes_nubank`.
 * Por isso a fonte "Contas" usa `ehDespesaReal`, que descarta as linhas de
 * cartão, e "Ambos" pode somar as duas sem contar o mesmo real duas vezes.
 */
import { format, startOfMonth, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { buscarPaginado } from './supabasePaginado'
import { ehDespesaReal, removerPrefixoCartao } from './tipoCartao'
import { formatBRL } from './format'
import {
  formatarMes,
  formatarPercentual,
  formatarVariacao,
  variacaoPercentual,
} from './relatoriosFormat'
import type { DocumentoRelatorio } from './relatorioDocumento'
import type { Destaque } from '@/components/relatorios/DestaquesRelatorio'

export const JANELAS_CATEGORIAS = [3, 6, 12] as const
export type JanelaCategorias = typeof JANELAS_CATEGORIAS[number]

export type FonteCategorias = 'cartao' | 'contas' | 'ambos'

export const FONTE_LABEL: Record<FonteCategorias, string> = {
  cartao: 'Compras no cartão',
  contas: 'Contas do planejamento',
  ambos: 'Cartão + contas',
}

export const RELATORIO_CATEGORIAS_EXPLICACOES = {
  ranking: 'Cada categoria somada na janela escolhida, com a média por mês e a comparação do último mês fechado contra essa média.',
  evolucao: 'Total gasto por mês na janela — a linha tracejada é a média do período.',
  recorrentes: 'Descrições que mais se repetem no período. É onde mora o gasto silencioso: assinaturas esquecidas, delivery de toda semana, o mesmo posto de gasolina.',
  fonte: 'Cartão usa as compras importadas da fatura. Contas usa as despesas do planejamento, descontando as linhas de quitação de fatura (que já estão nas compras).',
} as const

export interface ItemRecorrente {
  descricao: string
  total: number
  vezes: number
  categoria: string
}

export interface CategoriaAnalise {
  categoria: string
  total: number
  mediaMensal: number
  ultimoMes: number
  mesAnterior: number
  quantidade: number
  ticketMedio: number
  variacaoMesAMes: number | null
  variacaoVsMedia: number | null
  /** Total por mês, alinhado com `RelatorioCategorias.meses`. */
  serie: number[]
  participacao: number
}

export interface RelatorioCategorias {
  meses: Date[]
  janela: JanelaCategorias
  fonte: FonteCategorias
  categorias: CategoriaAnalise[]
  recorrentes: ItemRecorrente[]
  seriePeriodo: number[]
  totalPeriodo: number
  erros: string[]
}

interface Lancamento {
  mesIdx: number
  categoria: string
  descricao: string
  valor: number
}

/** Normaliza a descrição para agrupar "IFOOD *PEDIDO 123" e "IFOOD *PEDIDO 456". */
function chaveDescricao(descricao: string): string {
  return descricao
    .toUpperCase()
    .replace(/\d+/g, '')
    .replace(/[*#-]+/g, ' ')
    .replace(/\s*PARCELA\s*\/\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function buscarLancamentosCartao(
  faturas: string[],
  indicePorMes: Map<string, number>,
  erros: string[],
): Promise<Lancamento[]> {
  const { data, error, truncado } = await buscarPaginado<{
    valor: number; categoria: string | null; descricao: string; projeto_fatura: string
  }>((inicio, fim) =>
    supabase
      .from('transacoes_nubank')
      .select('valor, categoria, descricao, projeto_fatura')
      .in('projeto_fatura', faturas)
      .neq('status', 'ESTORNO')
      .neq('status', 'ESTORNADO')
      .range(inicio, fim),
  )

  if (truncado) erros.push('O período tem compras demais: o relatório mostra apenas as primeiras 20 mil.')

  if (error) {
    console.error('[relatorioCategorias] Falha ao buscar compras:', error)
    erros.push('Não foi possível carregar as compras do cartão.')
    return []
  }

  return data.flatMap(row => {
    const mesIdx = indicePorMes.get(row.projeto_fatura)
    if (mesIdx === undefined) return []
    return [{
      mesIdx,
      categoria: row.categoria || 'Sem categoria',
      descricao: row.descricao ?? '',
      valor: Number(row.valor ?? 0),
    }]
  })
}

async function buscarLancamentosContas(
  meses: string[],
  indicePorMes: Map<string, number>,
  erros: string[],
): Promise<Lancamento[]> {
  const { data, error } = await buscarPaginado<{
    item: string
    categoria: string | null
    valor_previsto: number | null
    valor_real: number | null
    pago: boolean | null
    mes_referencia: string
  }>((inicio, fim) =>
    supabase
      .from('planejamento')
      .select('item, categoria, valor_previsto, valor_real, pago, mes_referencia')
      .in('mes_referencia', meses)
      .range(inicio, fim),
  )

  if (error) {
    console.error('[relatorioCategorias] Falha ao buscar despesas do planejamento:', error)
    erros.push('Não foi possível carregar as despesas do planejamento.')
    return []
  }

  return data.flatMap(row => {
    const mesIdx = indicePorMes.get(row.mes_referencia)
    if (mesIdx === undefined) return []
    if (!ehDespesaReal(row.item)) return []
    const valor = row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : (row.valor_previsto ?? 0)
    if (valor <= 0) return []
    return [{
      mesIdx,
      categoria: row.categoria || 'Sem categoria',
      descricao: removerPrefixoCartao(row.item),
      valor: Number(valor),
    }]
  })
}

export async function buscarRelatorioCategorias(
  janela: JanelaCategorias,
  fonte: FonteCategorias,
  hoje: Date = new Date(),
): Promise<RelatorioCategorias> {
  const erros: string[] = []
  const meses = Array.from({ length: janela }, (_, i) => startOfMonth(subMonths(hoje, janela - 1 - i)))
  const mesesStr = meses.map(m => format(m, 'yyyy-MM-dd'))
  const indicePorMes = new Map(mesesStr.map((m, idx) => [m, idx]))

  const [doCartao, dasContas] = await Promise.all([
    fonte === 'contas' ? Promise.resolve([]) : buscarLancamentosCartao(mesesStr, indicePorMes, erros),
    fonte === 'cartao' ? Promise.resolve([]) : buscarLancamentosContas(mesesStr, indicePorMes, erros),
  ])

  const lancamentos = [...doCartao, ...dasContas]

  const porCategoria = new Map<string, { serie: number[]; total: number; quantidade: number }>()
  const seriePeriodo = new Array(janela).fill(0) as number[]
  const recorrentes = new Map<string, ItemRecorrente>()

  for (const l of lancamentos) {
    const atual = porCategoria.get(l.categoria) ?? {
      serie: new Array(janela).fill(0) as number[],
      total: 0,
      quantidade: 0,
    }
    atual.serie[l.mesIdx] += l.valor
    atual.total += l.valor
    atual.quantidade += 1
    porCategoria.set(l.categoria, atual)

    seriePeriodo[l.mesIdx] += l.valor

    const chave = chaveDescricao(l.descricao)
    if (chave.length >= 3) {
      const rec = recorrentes.get(chave) ?? { descricao: chave, total: 0, vezes: 0, categoria: l.categoria }
      rec.total += l.valor
      rec.vezes += 1
      recorrentes.set(chave, rec)
    }
  }

  const totalPeriodo = seriePeriodo.reduce((acc, v) => acc + v, 0)
  const ultimoIdx = janela - 1

  const categorias: CategoriaAnalise[] = [...porCategoria.entries()]
    .map(([categoria, dados]) => {
      const ultimoMes = dados.serie[ultimoIdx] ?? 0
      const mesAnterior = janela > 1 ? (dados.serie[ultimoIdx - 1] ?? 0) : 0
      const mediaMensal = dados.total / janela

      return {
        categoria,
        total: dados.total,
        mediaMensal,
        ultimoMes,
        mesAnterior,
        quantidade: dados.quantidade,
        ticketMedio: dados.quantidade > 0 ? dados.total / dados.quantidade : 0,
        variacaoMesAMes: variacaoPercentual(ultimoMes, mesAnterior),
        variacaoVsMedia: variacaoPercentual(ultimoMes, mediaMensal),
        serie: dados.serie,
        participacao: totalPeriodo > 0 ? (dados.total / totalPeriodo) * 100 : 0,
      }
    })
    .sort((a, b) => b.total - a.total)

  return {
    meses,
    janela,
    fonte,
    categorias,
    recorrentes: [...recorrentes.values()]
      .filter(r => r.vezes > 1)
      .sort((a, b) => b.total - a.total)
      .slice(0, 20),
    seriePeriodo,
    totalPeriodo,
    erros,
  }
}

// ── Leituras (puras) ───────────────────────────────────────────────────────

export interface IndicadoresCategorias {
  totalPeriodo: number
  mediaMensal: number
  ultimoMes: number
  variacaoUltimoVsMedia: number | null
  concentracaoTop3: number
  categoriasAtivas: number
}

export function indicadoresCategorias(relatorio: RelatorioCategorias): IndicadoresCategorias {
  const mediaMensal = relatorio.janela > 0 ? relatorio.totalPeriodo / relatorio.janela : 0
  const ultimoMes = relatorio.seriePeriodo[relatorio.seriePeriodo.length - 1] ?? 0
  const top3 = relatorio.categorias.slice(0, 3).reduce((acc, c) => acc + c.total, 0)

  return {
    totalPeriodo: relatorio.totalPeriodo,
    mediaMensal,
    ultimoMes,
    variacaoUltimoVsMedia: variacaoPercentual(ultimoMes, mediaMensal),
    concentracaoTop3: relatorio.totalPeriodo > 0 ? (top3 / relatorio.totalPeriodo) * 100 : 0,
    categoriasAtivas: relatorio.categorias.length,
  }
}

/** Categorias que mais subiram e mais caíram no último mês contra a própria média. */
export function movimentosRelevantes(relatorio: RelatorioCategorias, quantidade = 3) {
  const comparaveis = relatorio.categorias.filter(
    c => c.variacaoVsMedia !== null && c.mediaMensal >= 20,
  )
  const ordenadas = [...comparaveis].sort(
    (a, b) => (b.variacaoVsMedia ?? 0) - (a.variacaoVsMedia ?? 0),
  )
  return {
    altas: ordenadas.filter(c => (c.variacaoVsMedia ?? 0) > 10).slice(0, quantidade),
    quedas: ordenadas.filter(c => (c.variacaoVsMedia ?? 0) < -10).reverse().slice(0, quantidade),
  }
}

export function montarDestaquesCategorias(relatorio: RelatorioCategorias): Destaque[] {
  const ind = indicadoresCategorias(relatorio)
  const { altas, quedas } = movimentosRelevantes(relatorio)
  const destaques: Destaque[] = []

  if (relatorio.totalPeriodo === 0) return destaques

  for (const alta of altas) {
    destaques.push({
      tom: 'atencao',
      titulo: `${alta.categoria} subiu ${formatarVariacao(alta.variacaoVsMedia)} no último mês`,
      detalhe: `${formatBRL(alta.ultimoMes)} contra média de ${formatBRL(alta.mediaMensal)} nos ${relatorio.janela} meses.`,
    })
  }

  for (const queda of quedas) {
    destaques.push({
      tom: 'positivo',
      titulo: `${queda.categoria} caiu ${formatarVariacao(queda.variacaoVsMedia)} no último mês`,
      detalhe: `${formatBRL(queda.ultimoMes)} contra média de ${formatBRL(queda.mediaMensal)}.`,
    })
  }

  const top3 = relatorio.categorias.slice(0, 3).map(c => c.categoria).join(', ')
  destaques.push({
    tom: ind.concentracaoTop3 > 60 ? 'atencao' : 'neutro',
    titulo: `Top 3 categorias concentram ${formatarPercentual(ind.concentracaoTop3, 0)} do gasto`,
    detalhe: top3,
  })

  const recorrente = relatorio.recorrentes[0]
  if (recorrente) {
    destaques.push({
      tom: 'neutro',
      titulo: `Gasto que mais se repete: ${recorrente.descricao}`,
      detalhe: `${recorrente.vezes} lançamentos somando ${formatBRL(recorrente.total)} no período.`,
    })
  }

  return destaques
}

// ── Documento exportado ────────────────────────────────────────────────────

export function montarDocumentoCategorias(relatorio: RelatorioCategorias): DocumentoRelatorio {
  const ind = indicadoresCategorias(relatorio)
  const primeiro = relatorio.meses[0]
  const ultimo = relatorio.meses[relatorio.meses.length - 1]

  return {
    titulo: 'Raio-X por Categoria',
    subtitulo: `${FONTE_LABEL[relatorio.fonte]} · ${formatarMes(primeiro)} a ${formatarMes(ultimo)} (${relatorio.janela} meses)`,
    nomeArquivo: `relatorio-categorias-${format(ultimo, 'yyyy-MM')}-${relatorio.janela}m`,
    avisos: relatorio.erros,
    corCabecalho: [14, 116, 144],
    resumo: [
      { label: 'Total do período', valor: ind.totalPeriodo },
      { label: 'Média mensal', valor: ind.mediaMensal },
      { label: 'Último mês', valor: ind.ultimoMes },
      { label: 'Categorias com gasto', valor: String(ind.categoriasAtivas) },
      { label: 'Concentração top 3', valor: formatarPercentual(ind.concentracaoTop3, 0) },
    ],
    secoes: [
      {
        titulo: 'Evolução mensal',
        explicacao: RELATORIO_CATEGORIAS_EXPLICACOES.evolucao,
        colunas: ['Mês', 'Total'],
        linhas: relatorio.meses.map((mes, idx) => [formatarMes(mes), relatorio.seriePeriodo[idx]]),
        totais: [{ label: 'Total', valor: ind.totalPeriodo }],
      },
      {
        titulo: 'Ranking de categorias',
        explicacao: RELATORIO_CATEGORIAS_EXPLICACOES.ranking,
        colunas: ['Categoria', 'Lançamentos', 'Total', 'Participação', 'Média/mês', 'Último mês', 'Últ. vs média'],
        linhas: relatorio.categorias.map(c => [
          c.categoria,
          String(c.quantidade),
          c.total,
          formatarPercentual(c.participacao, 1),
          c.mediaMensal,
          c.ultimoMes,
          formatarVariacao(c.variacaoVsMedia),
        ]),
        totais: [{ label: 'Total do período', valor: ind.totalPeriodo }],
      },
      {
        titulo: 'Série por categoria e mês',
        explicacao: 'Matriz categoria × mês — a base para qualquer análise de tendência.',
        colunas: ['Categoria', ...relatorio.meses.map(formatarMes)],
        linhas: relatorio.categorias.map(c => [c.categoria, ...c.serie]),
      },
      {
        titulo: 'Gastos recorrentes',
        explicacao: RELATORIO_CATEGORIAS_EXPLICACOES.recorrentes,
        colunas: ['Descrição', 'Categoria', 'Vezes', 'Total', 'Média'],
        linhas: relatorio.recorrentes.map(r => [
          r.descricao, r.categoria, String(r.vezes), r.total, r.total / r.vezes,
        ]),
        vazio: 'Nenhum gasto se repetiu no período.',
      },
      {
        titulo: 'Destaques do período',
        colunas: ['Leitura'],
        linhas: montarDestaquesCategorias(relatorio).map(d => [
          d.detalhe ? `${d.titulo} — ${d.detalhe}` : d.titulo,
        ]),
        vazio: 'Sem destaques para este período.',
      },
    ],
    notaRodape: RELATORIO_CATEGORIAS_EXPLICACOES.fonte,
  }
}
