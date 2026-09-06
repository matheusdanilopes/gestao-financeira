import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { buscarPaginado } from './supabasePaginado'
import {
  buildContracts,
  buildContratosExtras,
  type TransacaoRowParcelamento,
  type PlanejamentoRowParcelamento,
} from './parcelamentoProjecao'
import { formatBRL } from './format'
import { formatarMes, formatarPercentual, variacaoPercentual } from './relatoriosFormat'
import type { DocumentoRelatorio } from './relatorioDocumento'
import type { Destaque } from '@/components/relatorios/DestaquesRelatorio'

const MESES_HISTORICO = 12
const MESES_PROJECAO = 12
const JANELA_PARCELAS_MESES = 36

/** Janelas de histórico oferecidas na tela. */
export const JANELAS_HISTORICO = [6, 12, 24] as const
export type JanelaHistorico = typeof JANELAS_HISTORICO[number]

export const ORIGEM_LABEL: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
  planejamento: 'Planejado',
}

export interface MesGasto {
  mes: Date
  total: number
  matheus: number
  jeniffer: number
  conjunto: number
  /** Nº de compras no mês — presente só no histórico (a projeção é derivada). */
  quantidade: number
}

export interface ParcelamentoAberto {
  descricao: string
  responsavel: string
  origem: 'nubank' | 'cartao1' | 'cartao2' | 'planejamento'
  valorParcela: number
  parcelaAtual: number
  totalParcelas: number
  parcelasRestantes: number
  valorRestante: number
  mesTermino: Date
}

/** Soma de um recorte (categoria, cartão) na janela analisada. */
export interface TotalPorChave {
  chave: string
  total: number
  quantidade: number
}

export interface RelatorioCartoes {
  historico: MesGasto[]
  projecao: MesGasto[]
  parcelamentosAbertos: ParcelamentoAberto[]
  /** Categorias mais caras da janela de histórico. */
  porCategoria: TotalPorChave[]
  /** Quanto cada cartão pesou na janela de histórico. */
  porCartao: TotalPorChave[]
  erros: string[]
}

export const RELATORIO_CARTOES_EXPLICACOES = {
  historico: 'Total gasto no cartão em cada mês da janela escolhida, com a divisão por responsável (estornos não são contabilizados).',
  projecao: 'Projeção das parcelas já lançadas para os próximos 12 meses, a partir do mês atual, com a divisão por responsável. Não inclui compras futuras ainda não realizadas.',
  parcelamentosAbertos: 'Parcelamentos em aberto reconstruídos a partir da fatura mais recente de cada cartão, mostrando quantas parcelas ainda faltam e quando cada um termina.',
  categorias: 'Para onde o dinheiro do cartão foi na janela escolhida, somado por categoria da compra.',
  cartoes: 'Peso de cada cartão no gasto total da janela — útil para decidir onde concentrar ou cortar.',
} as const

function novoMesGasto(mes: Date): MesGasto {
  return { mes, total: 0, matheus: 0, jeniffer: 0, conjunto: 0, quantidade: 0 }
}

function somarPorResponsavel(bucket: MesGasto, responsavel: string | null | undefined, valor: number) {
  bucket.total += valor
  if (responsavel === 'Matheus') bucket.matheus += valor
  else if (responsavel === 'Jeniffer') bucket.jeniffer += valor
  else bucket.conjunto += valor
}

function acumular(mapa: Map<string, TotalPorChave>, chave: string, valor: number) {
  const atual = mapa.get(chave) ?? { chave, total: 0, quantidade: 0 }
  atual.total += valor
  atual.quantidade += 1
  mapa.set(chave, atual)
}

type LinhaHistorico = {
  valor: number
  responsavel: string | null
  projeto_fatura: string
  categoria: string | null
  cartao: string | null
}

async function buscarHistorico(
  hoje: Date,
  meses: number,
  erros: string[],
): Promise<{ historico: MesGasto[]; porCategoria: TotalPorChave[]; porCartao: TotalPorChave[] }> {
  const listaMeses = Array.from({ length: meses }, (_, i) => startOfMonth(subMonths(hoje, meses - 1 - i)))
  const faturas = listaMeses.map(m => format(m, 'yyyy-MM-dd'))
  const bucketsPorFatura = new Map<string, MesGasto>()
  for (let i = 0; i < listaMeses.length; i++) bucketsPorFatura.set(faturas[i], novoMesGasto(listaMeses[i]))

  const { data, error, truncado } = await buscarPaginado<LinhaHistorico>((inicio, fim) =>
    supabase
      .from('transacoes_nubank')
      .select('valor, responsavel, projeto_fatura, categoria, cartao')
      .in('projeto_fatura', faturas)
      .neq('status', 'ESTORNO')
      .neq('status', 'ESTORNADO')
      .range(inicio, fim),
  )

  if (error) {
    console.error('[relatorioCartoes] Falha ao buscar histórico de gastos:', error)
    erros.push('Não foi possível carregar o histórico de gastos do cartão.')
  }
  if (truncado) {
    erros.push('A janela escolhida tem compras demais: o histórico considera apenas as primeiras 20 mil.')
  }

  const categorias = new Map<string, TotalPorChave>()
  const cartoes = new Map<string, TotalPorChave>()

  for (const row of data) {
    const bucket = bucketsPorFatura.get(row.projeto_fatura)
    if (!bucket) continue
    somarPorResponsavel(bucket, row.responsavel, row.valor)
    bucket.quantidade += 1
    acumular(categorias, row.categoria || 'Sem categoria', row.valor)
    acumular(cartoes, ORIGEM_LABEL[row.cartao ?? 'nubank'] ?? (row.cartao ?? 'NuBank'), row.valor)
  }

  return {
    historico: listaMeses.map(m => bucketsPorFatura.get(format(m, 'yyyy-MM-dd'))!),
    porCategoria: [...categorias.values()].sort((a, b) => b.total - a.total),
    porCartao: [...cartoes.values()].sort((a, b) => b.total - a.total),
  }
}

export async function buscarBaseContratos(erros: string[]) {
  const [{ data: maxNubank }, { data: maxCartao1 }, { data: maxCartao2 }] = await Promise.all([
    supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'nubank').order('projeto_fatura', { ascending: false }).limit(1),
    supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'cartao1').order('projeto_fatura', { ascending: false }).limit(1),
    supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'cartao2').order('projeto_fatura', { ascending: false }).limit(1),
  ])

  const cartoesEFaturas = ([
    ['nubank', maxNubank?.[0]?.projeto_fatura],
    ['cartao1', maxCartao1?.[0]?.projeto_fatura],
    ['cartao2', maxCartao2?.[0]?.projeto_fatura],
  ] as [string, string][]).filter(([, f]) => !!f)

  let transacoesUltimaFatura: TransacaoRowParcelamento[] = []
  if (cartoesEFaturas.length > 0) {
    const resultados = await Promise.all(
      cartoesEFaturas.map(([cartao, fatura]) =>
        supabase.from('transacoes_nubank').select('*').eq('cartao', cartao).eq('projeto_fatura', fatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO')
      )
    )
    for (const r of resultados) {
      if (r.error) {
        console.error('[relatorioCartoes] Falha ao buscar fatura mais recente:', r.error)
        erros.push('Não foi possível carregar a base para a projeção de parcelas.')
      }
    }
    transacoesUltimaFatura = resultados.flatMap(r => (r.data ?? []) as TransacaoRowParcelamento[])
  }

  const janelaInicio = format(subMonths(new Date(), JANELA_PARCELAS_MESES), 'yyyy-MM-dd')
  const { data: todasDespesas, error: errorDespesas } = await supabase
    .from('planejamento')
    .select('*')
    .not('item', 'ilike', '[RECEITA]%')
    .gte('mes_referencia', janelaInicio)

  if (errorDespesas) {
    console.error('[relatorioCartoes] Falha ao buscar despesas parceladas do planejamento:', errorDespesas)
    erros.push('Não foi possível carregar despesas parceladas do planejamento.')
  }

  return {
    contratos: buildContracts(transacoesUltimaFatura),
    contratosExtras: buildContratosExtras((todasDespesas ?? []) as PlanejamentoRowParcelamento[]),
  }
}

function calcularProjecao(
  hoje: Date,
  contratos: ReturnType<typeof buildContracts>,
  contratosExtras: ReturnType<typeof buildContratosExtras>,
): MesGasto[] {
  const meses = Array.from({ length: MESES_PROJECAO }, (_, i) => startOfMonth(addMonths(hoje, i + 1)))
  const buckets = meses.map(novoMesGasto)

  for (let i = 0; i < meses.length; i++) {
    const mesRef = meses[i]

    for (const { row, fatura, parcela } of contratos.values()) {
      const deltaM = (mesRef.getFullYear() - fatura.getFullYear()) * 12 + (mesRef.getMonth() - fatura.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
        somarPorResponsavel(buckets[i], row.responsavel, Number(row.valor ?? 0))
        buckets[i].quantidade += 1
      }
    }

    for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
      const deltaM = (mesRef.getFullYear() - mesExtra.getFullYear()) * 12 + (mesRef.getMonth() - mesExtra.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
        somarPorResponsavel(buckets[i], e.responsavel, Number(e.valor_previsto ?? 0))
        buckets[i].quantidade += 1
      }
    }
  }

  return buckets
}

function derivarParcelamentosAbertos(
  hoje: Date,
  contratos: ReturnType<typeof buildContracts>,
  contratosExtras: ReturnType<typeof buildContratosExtras>,
): ParcelamentoAberto[] {
  const hojeInicio = startOfMonth(hoje)
  const abertos: ParcelamentoAberto[] = []

  for (const { row, fatura, parcela } of contratos.values()) {
    const origem = subMonths(fatura, parcela.atual - 1)
    const mesTermino = addMonths(origem, parcela.total - 1)
    const parcelasRestantes = (mesTermino.getFullYear() - hojeInicio.getFullYear()) * 12 + (mesTermino.getMonth() - hojeInicio.getMonth()) + 1
    if (parcelasRestantes <= 0) continue

    const valor = Number(row.valor ?? 0)
    abertos.push({
      descricao: String(row.descricao ?? ''),
      responsavel: String(row.responsavel ?? ''),
      origem: (row.cartao as 'nubank' | 'cartao1' | 'cartao2') ?? 'nubank',
      valorParcela: valor,
      parcelaAtual: parcela.total - parcelasRestantes + 1,
      totalParcelas: parcela.total,
      parcelasRestantes,
      valorRestante: valor * parcelasRestantes,
      mesTermino,
    })
  }

  for (const { row: e, mesRef, parcela } of contratosExtras.values()) {
    const origem = subMonths(mesRef, parcela.atual - 1)
    const mesTermino = addMonths(origem, parcela.total - 1)
    const parcelasRestantes = (mesTermino.getFullYear() - hojeInicio.getFullYear()) * 12 + (mesTermino.getMonth() - hojeInicio.getMonth()) + 1
    if (parcelasRestantes <= 0) continue

    const valor = Number(e.valor_previsto ?? 0)
    abertos.push({
      descricao: String(e.item ?? ''),
      responsavel: String(e.responsavel ?? ''),
      origem: 'planejamento',
      valorParcela: valor,
      parcelaAtual: parcela.total - parcelasRestantes + 1,
      totalParcelas: parcela.total,
      parcelasRestantes,
      valorRestante: valor * parcelasRestantes,
      mesTermino,
    })
  }

  return abertos.sort((a, b) => a.mesTermino.getTime() - b.mesTermino.getTime())
}

export async function buscarRelatorioCartoes(
  hoje: Date = new Date(),
  opcoes: { mesesHistorico?: number } = {},
): Promise<RelatorioCartoes> {
  const erros: string[] = []
  const mesesHistorico = opcoes.mesesHistorico ?? MESES_HISTORICO

  const [{ historico, porCategoria, porCartao }, { contratos, contratosExtras }] = await Promise.all([
    buscarHistorico(hoje, mesesHistorico, erros),
    buscarBaseContratos(erros),
  ])

  const projecao = calcularProjecao(hoje, contratos, contratosExtras)
  const parcelamentosAbertos = derivarParcelamentosAbertos(hoje, contratos, contratosExtras)

  return { historico, projecao, parcelamentosAbertos, porCategoria, porCartao, erros }
}

// ── Leituras (puras) ───────────────────────────────────────────────────────

export function somaTotal(meses: MesGasto[]): number {
  return meses.reduce((acc, m) => acc + m.total, 0)
}

export interface IndicadoresCartoes {
  totalPeriodo: number
  mediaMensal: number
  mesMaisCaro: MesGasto | null
  ultimoMes: MesGasto | null
  variacaoUltimoVsMedia: number | null
  totalProjetado: number
  comprometidoParcelas: number
  proximaFaturaProjetada: number
}

export function indicadoresCartoes(relatorio: RelatorioCartoes): IndicadoresCartoes {
  const historico = relatorio.historico
  const totalPeriodo = somaTotal(historico)
  const mediaMensal = historico.length > 0 ? totalPeriodo / historico.length : 0
  const mesMaisCaro = historico.length > 0
    ? historico.reduce((maior, m) => (m.total > maior.total ? m : maior), historico[0])
    : null
  const ultimoMes = historico.length > 0 ? historico[historico.length - 1] : null

  return {
    totalPeriodo,
    mediaMensal,
    mesMaisCaro,
    ultimoMes,
    variacaoUltimoVsMedia: ultimoMes ? variacaoPercentual(ultimoMes.total, mediaMensal) : null,
    totalProjetado: somaTotal(relatorio.projecao),
    comprometidoParcelas: relatorio.parcelamentosAbertos.reduce((acc, p) => acc + p.valorRestante, 0),
    proximaFaturaProjetada: relatorio.projecao[0]?.total ?? 0,
  }
}

export function montarDestaquesCartoes(relatorio: RelatorioCartoes): Destaque[] {
  const ind = indicadoresCartoes(relatorio)
  const destaques: Destaque[] = []

  if (ind.ultimoMes && ind.variacaoUltimoVsMedia !== null) {
    const acima = ind.variacaoUltimoVsMedia > 0
    destaques.push({
      tom: Math.abs(ind.variacaoUltimoVsMedia) < 10 ? 'neutro' : acima ? 'atencao' : 'positivo',
      titulo: `Último mês ${acima ? 'acima' : 'abaixo'} da média do período (${formatarPercentual(Math.abs(ind.variacaoUltimoVsMedia), 1)})`,
      detalhe: `${formatarMes(ind.ultimoMes.mes)}: ${formatBRL(ind.ultimoMes.total)} · média ${formatBRL(ind.mediaMensal)}.`,
    })
  }

  if (ind.mesMaisCaro) {
    destaques.push({
      tom: 'neutro',
      titulo: `Mês mais caro: ${formatarMes(ind.mesMaisCaro.mes)} (${formatBRL(ind.mesMaisCaro.total)})`,
      detalhe: `${ind.mesMaisCaro.quantidade} compras no mês.`,
    })
  }

  if (ind.comprometidoParcelas > 0) {
    const meses = relatorio.parcelamentosAbertos.reduce((max, p) => Math.max(max, p.parcelasRestantes), 0)
    destaques.push({
      tom: ind.comprometidoParcelas > ind.mediaMensal * 3 ? 'atencao' : 'neutro',
      titulo: `${formatBRL(ind.comprometidoParcelas)} já comprometidos em parcelas futuras`,
      detalhe: `${relatorio.parcelamentosAbertos.length} parcelamento(s) em aberto; o último termina em ${meses} mês(es).`,
    })
  }

  const topCategoria = relatorio.porCategoria[0]
  if (topCategoria && ind.totalPeriodo > 0) {
    destaques.push({
      tom: 'neutro',
      titulo: `Maior categoria do período: ${topCategoria.chave} (${formatBRL(topCategoria.total)})`,
      detalhe: `${formatarPercentual((topCategoria.total / ind.totalPeriodo) * 100, 0)} do gasto no cartão, em ${topCategoria.quantidade} compras.`,
    })
  }

  const terminandoAgora = relatorio.parcelamentosAbertos.filter(p => p.parcelasRestantes <= 2)
  if (terminandoAgora.length > 0) {
    const alivio = terminandoAgora.reduce((acc, p) => acc + p.valorParcela, 0)
    destaques.push({
      tom: 'positivo',
      titulo: `${terminandoAgora.length} parcelamento(s) terminam nos próximos 2 meses`,
      detalhe: `Isso libera ${formatBRL(alivio)} por mês na fatura.`,
    })
  }

  return destaques
}

// ── Documento exportado ────────────────────────────────────────────────────

function linhasMesGasto(meses: MesGasto[]) {
  return meses.map(m => [formatarMes(m.mes), m.total, m.matheus, m.jeniffer, m.conjunto])
}

export function montarDocumentoCartoes(relatorio: RelatorioCartoes, mesesHistorico: number): DocumentoRelatorio {
  const ind = indicadoresCartoes(relatorio)

  return {
    titulo: 'Relatório de Gastos no Cartão',
    subtitulo: `Histórico dos últimos ${mesesHistorico} meses e projeção de 12 meses`,
    nomeArquivo: `relatorio-cartoes-${format(new Date(), 'yyyy-MM')}`,
    avisos: relatorio.erros,
    corCabecalho: [76, 29, 149],
    resumo: [
      { label: `Total ${mesesHistorico} meses`, valor: ind.totalPeriodo },
      { label: 'Média mensal', valor: ind.mediaMensal },
      { label: 'Mês mais caro', valor: ind.mesMaisCaro ? `${formatarMes(ind.mesMaisCaro.mes)} (${formatBRL(ind.mesMaisCaro.total)})` : '—' },
      { label: 'Próxima fatura projetada', valor: ind.proximaFaturaProjetada },
      { label: 'Comprometido em parcelas', valor: ind.comprometidoParcelas },
    ],
    secoes: [
      {
        titulo: `Histórico de gastos (${mesesHistorico} meses)`,
        explicacao: RELATORIO_CARTOES_EXPLICACOES.historico,
        colunas: ['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto'],
        linhas: linhasMesGasto(relatorio.historico),
        totais: [{ label: `Total ${mesesHistorico} meses`, valor: ind.totalPeriodo }],
      },
      {
        titulo: 'Gastos por categoria no período',
        explicacao: RELATORIO_CARTOES_EXPLICACOES.categorias,
        colunas: ['Categoria', 'Compras', 'Total', 'Média por compra'],
        linhas: relatorio.porCategoria.map(c => [
          c.chave, String(c.quantidade), c.total, c.quantidade > 0 ? c.total / c.quantidade : 0,
        ]),
      },
      {
        titulo: 'Gastos por cartão no período',
        explicacao: RELATORIO_CARTOES_EXPLICACOES.cartoes,
        colunas: ['Cartão', 'Compras', 'Total'],
        linhas: relatorio.porCartao.map(c => [c.chave, String(c.quantidade), c.total]),
      },
      {
        titulo: 'Projeção de parcelamentos (12 meses)',
        explicacao: RELATORIO_CARTOES_EXPLICACOES.projecao,
        colunas: ['Mês', 'Total', 'Matheus', 'Jeniffer', 'Conjunto'],
        linhas: linhasMesGasto(relatorio.projecao),
        totais: [{ label: 'Total projetado', valor: ind.totalProjetado }],
      },
      {
        titulo: 'Parcelamentos em aberto',
        explicacao: RELATORIO_CARTOES_EXPLICACOES.parcelamentosAbertos,
        colunas: ['Descrição', 'Responsável', 'Origem', 'Parcela', 'Restam', 'Valor da parcela', 'Valor restante', 'Término'],
        linhas: relatorio.parcelamentosAbertos.map(p => [
          p.descricao,
          p.responsavel,
          ORIGEM_LABEL[p.origem] ?? p.origem,
          `${p.parcelaAtual}/${p.totalParcelas}`,
          String(p.parcelasRestantes),
          p.valorParcela,
          p.valorRestante,
          formatarMes(p.mesTermino),
        ]),
        totais: [{ label: 'Valor restante', valor: ind.comprometidoParcelas }],
      },
      {
        titulo: 'Destaques do período',
        colunas: ['Leitura'],
        linhas: montarDestaquesCartoes(relatorio).map(d => [
          d.detalhe ? `${d.titulo} — ${d.detalhe}` : d.titulo,
        ]),
        vazio: 'Sem destaques para este período.',
      },
    ],
    notaRodape:
      'A projeção considera apenas parcelas já lançadas — compras futuras e assinaturas ainda não cobradas não entram.',
  }
}
