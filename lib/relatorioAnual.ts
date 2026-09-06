/**
 * Fechamento do ano: os 12 meses lado a lado — o que entrou, o que saiu, o que
 * sobrou e quanto foi para investimento — com o ano anterior como referência.
 */
import { format } from 'date-fns'
import { supabase } from './supabaseClient'
import { buscarPaginado } from './supabasePaginado'
import { ehDespesaReal } from './tipoCartao'
import { formatBRL } from './format'
import { formatarPercentual, formatarVariacao, variacaoPercentual } from './relatoriosFormat'
import type { DocumentoRelatorio } from './relatorioDocumento'
import type { Destaque } from '@/components/relatorios/DestaquesRelatorio'

const RECEITA_PREFIXO = '[RECEITA] '

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export const RELATORIO_ANUAL_EXPLICACOES = {
  meses: 'Cada mês do ano com receita recebida, despesa paga, saldo e aportes. "Previsto" é o que estava planejado; "realizado" é o que de fato aconteceu.',
  categorias: 'Despesas do ano somadas por categoria, excluindo as linhas de quitação de fatura (o gasto do cartão entra pelas compras).',
  poupanca: 'Percentual da receita recebida no ano que sobrou depois das despesas pagas.',
} as const

export interface MesAnual {
  mesNum: number
  label: string
  receitasPrevistas: number
  receitasRecebidas: number
  despesasPrevistas: number
  despesasReais: number
  saldo: number
  aportes: number
  gastoCartao: number
}

export interface CategoriaAnual {
  categoria: string
  total: number
  participacao: number
}

export interface RelatorioAnual {
  ano: number
  meses: MesAnual[]
  categorias: CategoriaAnual[]
  totalReceitas: number
  totalDespesas: number
  totalAportes: number
  totalCartao: number
  saldoAno: number
  /** Receita e despesa do ano anterior, quando houver dados. */
  anoAnterior: { receitas: number; despesas: number; saldo: number } | null
  erros: string[]
}

type PlanejamentoAnualRow = {
  item: string
  categoria: string | null
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
  mes_referencia: string
}

function mesDoISO(iso: string): number {
  return Number(iso.substring(5, 7)) - 1
}

function novoMes(idx: number): MesAnual {
  return {
    mesNum: idx + 1,
    label: MESES_CURTOS[idx],
    receitasPrevistas: 0,
    receitasRecebidas: 0,
    despesasPrevistas: 0,
    despesasReais: 0,
    saldo: 0,
    aportes: 0,
    gastoCartao: 0,
  }
}

async function totaisDoAno(ano: number): Promise<{ receitas: number; despesas: number } | null> {
  const { data, error } = await buscarPaginado<Omit<PlanejamentoAnualRow, 'categoria'>>((de, ate) =>
    supabase
      .from('planejamento')
      .select('item, valor_previsto, valor_real, pago, mes_referencia')
      .gte('mes_referencia', `${ano}-01-01`)
      .lte('mes_referencia', `${ano}-12-01`)
      .range(de, ate),
  )

  if (error || data.length === 0) return null

  let receitas = 0
  let despesas = 0
  for (const row of data) {
    const realizado = row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : 0
    if (row.item.startsWith(RECEITA_PREFIXO)) receitas += realizado
    else if (row.item !== 'Receita Total') despesas += realizado
  }
  return { receitas, despesas }
}

export async function buscarRelatorioAnual(ano: number): Promise<RelatorioAnual> {
  const erros: string[] = []
  const inicio = `${ano}-01-01`
  const fimMesRef = `${ano}-12-01`
  const fimDia = `${ano}-12-31`

  const [planRes, transRes, aportesRes, anteriorRes] = await Promise.all([
    buscarPaginado<PlanejamentoAnualRow>((de, ate) =>
      supabase
        .from('planejamento')
        .select('item, categoria, valor_previsto, valor_real, pago, mes_referencia')
        .gte('mes_referencia', inicio)
        .lte('mes_referencia', fimMesRef)
        .range(de, ate),
    ),
    buscarPaginado<{ valor: number; projeto_fatura: string }>((de, ate) =>
      supabase
        .from('transacoes_nubank')
        .select('valor, projeto_fatura')
        .gte('projeto_fatura', inicio)
        .lte('projeto_fatura', fimMesRef)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO')
        .range(de, ate),
    ),
    buscarPaginado<{ valor: number; data_aporte: string }>((de, ate) =>
      supabase
        .from('investimentos_aportes')
        .select('valor, data_aporte')
        .gte('data_aporte', inicio)
        .lte('data_aporte', fimDia)
        .range(de, ate),
    ),
    totaisDoAno(ano - 1),
  ])

  if (planRes.error) {
    console.error('[relatorioAnual] Falha ao buscar planejamento do ano:', planRes.error)
    erros.push('Não foi possível carregar receitas e despesas do ano.')
  }
  if (transRes.error) {
    console.error('[relatorioAnual] Falha ao buscar compras do ano:', transRes.error)
    erros.push('Não foi possível carregar os gastos no cartão.')
  }
  if (aportesRes.error) {
    console.error('[relatorioAnual] Falha ao buscar aportes do ano:', aportesRes.error)
    erros.push('Não foi possível carregar os aportes de investimento.')
  }

  const meses = Array.from({ length: 12 }, (_, i) => novoMes(i))
  const categorias = new Map<string, number>()

  for (const row of planRes.data) {
    const idx = mesDoISO(row.mes_referencia)
    if (idx < 0 || idx > 11) continue
    const mes = meses[idx]
    const previsto = row.valor_previsto ?? 0
    const realizado = row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : 0

    if (row.item.startsWith(RECEITA_PREFIXO)) {
      mes.receitasPrevistas += previsto
      mes.receitasRecebidas += realizado
      continue
    }
    if (row.item === 'Receita Total') continue

    mes.despesasPrevistas += previsto
    mes.despesasReais += realizado

    // O ranking de categorias usa só despesas "reais" (sem as linhas de
    // quitação de fatura), senão o cartão apareceria como uma categoria
    // gigante que já está distribuída nas compras.
    if (ehDespesaReal(row.item) && realizado > 0) {
      const chave = row.categoria || 'Sem categoria'
      categorias.set(chave, (categorias.get(chave) ?? 0) + realizado)
    }
  }

  for (const row of transRes.data) {
    const idx = mesDoISO(row.projeto_fatura)
    if (idx >= 0 && idx <= 11) meses[idx].gastoCartao += Number(row.valor ?? 0)
  }

  for (const row of aportesRes.data) {
    const idx = mesDoISO(row.data_aporte)
    if (idx >= 0 && idx <= 11) meses[idx].aportes += Number(row.valor ?? 0)
  }

  for (const mes of meses) mes.saldo = mes.receitasRecebidas - mes.despesasReais

  const totalReceitas = meses.reduce((acc, m) => acc + m.receitasRecebidas, 0)
  const totalDespesas = meses.reduce((acc, m) => acc + m.despesasReais, 0)
  const totalCategoria = [...categorias.values()].reduce((acc, v) => acc + v, 0)

  const anterior = anteriorRes
  return {
    ano,
    meses,
    categorias: [...categorias.entries()]
      .map(([categoria, total]) => ({
        categoria,
        total,
        participacao: totalCategoria > 0 ? (total / totalCategoria) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total),
    totalReceitas,
    totalDespesas,
    totalAportes: meses.reduce((acc, m) => acc + m.aportes, 0),
    totalCartao: meses.reduce((acc, m) => acc + m.gastoCartao, 0),
    saldoAno: totalReceitas - totalDespesas,
    anoAnterior: anterior
      ? { ...anterior, saldo: anterior.receitas - anterior.despesas }
      : null,
    erros,
  }
}

// ── Leituras (puras) ───────────────────────────────────────────────────────

export interface IndicadoresAnuais {
  mesesComMovimento: number
  mediaReceitas: number
  mediaDespesas: number
  melhorMes: MesAnual | null
  piorMes: MesAnual | null
  mesesNoVermelho: MesAnual[]
  taxaPoupanca: number | null
}

export function indicadoresAnuais(relatorio: RelatorioAnual): IndicadoresAnuais {
  const comMovimento = relatorio.meses.filter(m => m.receitasRecebidas > 0 || m.despesasReais > 0)
  const divisor = comMovimento.length || 1

  return {
    mesesComMovimento: comMovimento.length,
    mediaReceitas: relatorio.totalReceitas / divisor,
    mediaDespesas: relatorio.totalDespesas / divisor,
    melhorMes: comMovimento.length > 0
      ? comMovimento.reduce((melhor, m) => (m.saldo > melhor.saldo ? m : melhor), comMovimento[0])
      : null,
    piorMes: comMovimento.length > 0
      ? comMovimento.reduce((pior, m) => (m.saldo < pior.saldo ? m : pior), comMovimento[0])
      : null,
    mesesNoVermelho: comMovimento.filter(m => m.saldo < 0),
    taxaPoupanca: relatorio.totalReceitas > 0
      ? (relatorio.saldoAno / relatorio.totalReceitas) * 100
      : null,
  }
}

export function montarDestaquesAnual(relatorio: RelatorioAnual): Destaque[] {
  const ind = indicadoresAnuais(relatorio)
  const destaques: Destaque[] = []

  if (ind.mesesComMovimento === 0) return destaques

  if (ind.taxaPoupanca !== null) {
    destaques.push({
      tom: ind.taxaPoupanca >= 20 ? 'positivo' : ind.taxaPoupanca >= 0 ? 'neutro' : 'negativo',
      titulo: `Taxa de poupança do ano: ${formatarPercentual(ind.taxaPoupanca, 1)}`,
      detalhe: `${formatBRL(relatorio.totalReceitas)} recebidos, ${formatBRL(relatorio.totalDespesas)} pagos, sobra de ${formatBRL(relatorio.saldoAno)}.`,
    })
  }

  if (relatorio.anoAnterior) {
    const varDespesas = variacaoPercentual(relatorio.totalDespesas, relatorio.anoAnterior.despesas)
    if (varDespesas !== null) {
      destaques.push({
        tom: varDespesas > 0 ? 'atencao' : 'positivo',
        titulo: `Despesas ${varDespesas > 0 ? 'acima' : 'abaixo'} de ${relatorio.ano - 1} (${formatarVariacao(varDespesas)})`,
        detalhe: `${formatBRL(relatorio.totalDespesas)} contra ${formatBRL(relatorio.anoAnterior.despesas)} no ano anterior.`,
      })
    }
    const varReceitas = variacaoPercentual(relatorio.totalReceitas, relatorio.anoAnterior.receitas)
    if (varReceitas !== null) {
      destaques.push({
        tom: varReceitas >= 0 ? 'positivo' : 'atencao',
        titulo: `Receitas ${varReceitas >= 0 ? 'acima' : 'abaixo'} de ${relatorio.ano - 1} (${formatarVariacao(varReceitas)})`,
        detalhe: `${formatBRL(relatorio.totalReceitas)} contra ${formatBRL(relatorio.anoAnterior.receitas)}.`,
      })
    }
  }

  if (ind.melhorMes && ind.piorMes && ind.melhorMes !== ind.piorMes) {
    destaques.push({
      tom: 'neutro',
      titulo: `Melhor mês: ${ind.melhorMes.label} (${formatBRL(ind.melhorMes.saldo)}) · pior: ${ind.piorMes.label} (${formatBRL(ind.piorMes.saldo)})`,
      detalhe: `Diferença de ${formatBRL(ind.melhorMes.saldo - ind.piorMes.saldo)} entre o melhor e o pior mês.`,
    })
  }

  if (ind.mesesNoVermelho.length > 0) {
    destaques.push({
      tom: 'atencao',
      titulo: `${ind.mesesNoVermelho.length} mês(es) fecharam no vermelho`,
      detalhe: ind.mesesNoVermelho.map(m => m.label).join(', '),
    })
  }

  if (relatorio.totalAportes > 0) {
    destaques.push({
      tom: 'positivo',
      titulo: `${formatBRL(relatorio.totalAportes)} aportados em investimentos no ano`,
      detalhe: relatorio.totalReceitas > 0
        ? `${formatarPercentual((relatorio.totalAportes / relatorio.totalReceitas) * 100, 1)} de tudo o que entrou.`
        : undefined,
    })
  }

  const topCategoria = relatorio.categorias[0]
  if (topCategoria) {
    destaques.push({
      tom: 'neutro',
      titulo: `Maior categoria do ano: ${topCategoria.categoria} (${formatBRL(topCategoria.total)})`,
      detalhe: `${formatarPercentual(topCategoria.participacao, 0)} das despesas categorizadas.`,
    })
  }

  return destaques
}

// ── Documento exportado ────────────────────────────────────────────────────

export function montarDocumentoAnual(relatorio: RelatorioAnual): DocumentoRelatorio {
  const ind = indicadoresAnuais(relatorio)

  return {
    titulo: `Fechamento Anual ${relatorio.ano}`,
    subtitulo: `Janeiro a dezembro de ${relatorio.ano}`,
    nomeArquivo: `relatorio-anual-${relatorio.ano}`,
    avisos: relatorio.erros,
    corCabecalho: [22, 101, 52],
    resumo: [
      { label: 'Receitas recebidas', valor: relatorio.totalReceitas },
      { label: 'Despesas pagas', valor: relatorio.totalDespesas },
      { label: 'Saldo do ano', valor: relatorio.saldoAno },
      { label: 'Aportes', valor: relatorio.totalAportes },
      { label: 'Gasto no cartão', valor: relatorio.totalCartao },
      { label: 'Taxa de poupança', valor: ind.taxaPoupanca === null ? '—' : formatarPercentual(ind.taxaPoupanca, 1) },
    ],
    secoes: [
      {
        titulo: 'Mês a mês',
        explicacao: RELATORIO_ANUAL_EXPLICACOES.meses,
        colunas: ['Mês', 'Receita prev.', 'Receita receb.', 'Despesa prev.', 'Despesa paga', 'Saldo', 'Aportes', 'Cartão'],
        linhas: relatorio.meses.map(m => [
          m.label, m.receitasPrevistas, m.receitasRecebidas,
          m.despesasPrevistas, m.despesasReais, m.saldo, m.aportes, m.gastoCartao,
        ]),
        totais: [
          { label: 'Receitas', valor: relatorio.totalReceitas },
          { label: 'Despesas', valor: relatorio.totalDespesas },
          { label: 'Saldo', valor: relatorio.saldoAno },
        ],
      },
      {
        titulo: 'Despesas por categoria no ano',
        explicacao: RELATORIO_ANUAL_EXPLICACOES.categorias,
        colunas: ['Categoria', 'Total', 'Participação'],
        linhas: relatorio.categorias.map(c => [
          c.categoria, c.total, formatarPercentual(c.participacao, 1),
        ]),
        vazio: 'Nenhuma despesa categorizada no ano.',
      },
      {
        titulo: 'Comparação com o ano anterior',
        colunas: ['Indicador', `${relatorio.ano - 1}`, `${relatorio.ano}`, 'Variação'],
        linhas: relatorio.anoAnterior
          ? [
              ['Receitas recebidas', relatorio.anoAnterior.receitas, relatorio.totalReceitas,
                formatarVariacao(variacaoPercentual(relatorio.totalReceitas, relatorio.anoAnterior.receitas))],
              ['Despesas pagas', relatorio.anoAnterior.despesas, relatorio.totalDespesas,
                formatarVariacao(variacaoPercentual(relatorio.totalDespesas, relatorio.anoAnterior.despesas))],
              ['Saldo', relatorio.anoAnterior.saldo, relatorio.saldoAno,
                formatarVariacao(variacaoPercentual(relatorio.saldoAno, relatorio.anoAnterior.saldo))],
            ]
          : [],
        vazio: `Sem dados de ${relatorio.ano - 1} para comparar.`,
      },
      {
        titulo: 'Destaques do ano',
        colunas: ['Leitura'],
        linhas: montarDestaquesAnual(relatorio).map(d => [
          d.detalhe ? `${d.titulo} — ${d.detalhe}` : d.titulo,
        ]),
        vazio: 'Sem movimento registrado neste ano.',
      },
    ],
    notaRodape:
      'O gasto no cartão é informativo: ele já entra nas despesas pelo pagamento da fatura, então não deve ser somado ao total de despesas.',
  }
}

/** Anos que fazem sentido oferecer no seletor: o atual e os quatro anteriores. */
export function anosDisponiveis(hoje: Date = new Date()): number[] {
  const atual = Number(format(hoje, 'yyyy'))
  return [atual, atual - 1, atual - 2, atual - 3, atual - 4]
}
