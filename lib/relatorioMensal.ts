import { format, startOfMonth, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { buscarPaginado } from './supabasePaginado'
import { calcularSaldoInvestimentos } from './calcularSaldoInvestimentos'
import { ehLinhaDeCartao, removerPrefixoCartao } from './tipoCartao'
import { formatBRL } from './format'
import {
  formatarData,
  formatarMesLongo,
  formatarPercentual,
  formatarVariacao,
  variacaoPercentual,
} from './relatoriosFormat'
import type { DocumentoRelatorio } from './relatorioDocumento'
import type { Destaque } from '@/components/relatorios/DestaquesRelatorio'

const RECEITA_PREFIXO = '[RECEITA] '

export type StatusDespesa = 'Pago' | 'Pendente' | 'Vencida'

export interface RelatorioReceitaItem {
  id: string
  item: string
  responsavel: string
  valorPrevisto: number
  valorRecebido: number
  pago: boolean
}

export interface RelatorioDespesaItem {
  id: string
  item: string
  categoria: string
  responsavel: string
  /** "Cartão" quando a linha é a quitação de uma fatura; "Conta" no resto. */
  tipo: 'Cartão' | 'Conta'
  status: StatusDespesa
  dataVencimento: string | null
  dataPagamento: string | null
  valorPrevisto: number
  valorReal: number | null
}

export interface RelatorioCompraItem {
  id: string
  data: string
  descricao: string
  responsavel: string
  categoria: string | null
  cartao: string
  valor: number
}

export interface RelatorioInvestimentoItem {
  id: string
  descricao: string
  percentual: number
  valorPlanejado: number
  valorAportado: number
}

/** Agregação por chave (categoria, responsável, cartão…) usada nos rankings. */
export interface AgrupamentoRelatorio {
  chave: string
  previsto: number
  realizado: number
  quantidade: number
}

/** Fotografia enxuta de um mês, usada só para comparar com o mês do relatório. */
export interface ResumoComparativo {
  receitasRecebidas: number
  despesasReais: number
  comprasTotal: number
  saldoRealizado: number
}

export interface RelatorioMensal {
  mesRefStr: string
  receitas: { itens: RelatorioReceitaItem[]; totalPrevisto: number; totalRecebido: number }
  despesas: { itens: RelatorioDespesaItem[]; totalPrevisto: number; totalReal: number }
  compras: { itens: RelatorioCompraItem[]; total: number }
  investimentos: { itens: RelatorioInvestimentoItem[]; totalPlanejado: number; totalAportado: number }
  saldoPrevisto: number
  saldoRealizado: number
  /** Mesmos números do mês anterior — base das variações exibidas nos KPIs. */
  comparativo: ResumoComparativo | null
  erros: string[]
}

export const RELATORIO_EXPLICACOES = {
  receitas: 'Valores previstos e recebidos no mês: salário, freelas e outras entradas de dinheiro.',
  despesas: 'Contas e gastos previstos no mês, fixos ou variáveis, pagos ou pendentes. "Vencida" é uma conta ainda não paga cuja data de vencimento já passou.',
  compras: 'Compras feitas no cartão de crédito que entraram na fatura deste mês (estornos não são contabilizados).',
  investimentos: 'Valor planejado (percentual sobre o saldo do mês) e valor efetivamente aportado em cada investimento.',
  execucao: 'Quanto do que foi planejado já virou realidade: recebido sobre previsto nas receitas e pago sobre previsto nas despesas.',
  categorias: 'Despesas do mês somadas por categoria — mostra para onde o dinheiro foi, não linha a linha, mas por tema.',
} as const

type PlanejamentoRow = {
  id: string
  item: string
  responsavel: string | null
  categoria: string | null
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
  data_vencimento?: string | null
  data_pagamento?: string | null
}

type RecebimentoRow = {
  planejamento_id: string
  valor: number
}

type TransacaoRow = {
  id: string
  data_compra: string | null
  data: string | null
  descricao: string
  responsavel: string
  categoria: string | null
  cartao: string | null
  valor: number
  status: string | null
}

type InvestimentoRow = {
  id: string
  descricao: string
  percentual: number
}

type AporteRow = {
  investimento_id: string
  valor: number
}

const CARTAO_LABEL: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

function ehEstorno(status: string | null): boolean {
  return status === 'ESTORNO' || status === 'ESTORNADO'
}

async function buscarReceitas(
  mesRefStr: string,
  erros: string[],
): Promise<{ itens: RelatorioReceitaItem[]; totalPrevisto: number; totalRecebido: number }> {
  const { data: lista, error } = await supabase
    .from('planejamento')
    .select('id, item, responsavel, valor_previsto, valor_real, pago')
    .eq('mes_referencia', mesRefStr)
    .ilike('item', '[RECEITA]%')
    .order('item', { ascending: true })

  if (error) {
    console.error('[relatorioMensal] Falha ao buscar receitas:', error)
    erros.push('Não foi possível carregar as receitas.')
  }

  const rows = (lista ?? []) as PlanejamentoRow[]
  const ids = rows.map(r => r.id)

  const recebimentosPorItem: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: recs, error: errorRecs } = await supabase
      .from('receitas_recebimentos')
      .select('planejamento_id, valor')
      .in('planejamento_id', ids)
    if (errorRecs) {
      console.error('[relatorioMensal] Falha ao buscar recebimentos:', errorRecs)
      erros.push('Não foi possível carregar os recebimentos parciais de receitas.')
    }
    for (const r of (recs ?? []) as RecebimentoRow[]) {
      recebimentosPorItem[r.planejamento_id] = (recebimentosPorItem[r.planejamento_id] ?? 0) + r.valor
    }
  }

  const itens: RelatorioReceitaItem[] = rows.map(row => {
    const totalRecebido = recebimentosPorItem[row.id]
    const valorRecebido = totalRecebido !== undefined
      ? totalRecebido
      : row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : 0

    return {
      id: row.id,
      item: row.item.startsWith(RECEITA_PREFIXO) ? row.item.replace(RECEITA_PREFIXO, '') : row.item,
      responsavel: row.responsavel ?? '',
      valorPrevisto: row.valor_previsto ?? 0,
      valorRecebido,
      pago: !!row.pago,
    }
  })

  return {
    itens,
    totalPrevisto: itens.reduce((acc, i) => acc + i.valorPrevisto, 0),
    totalRecebido: itens.reduce((acc, i) => acc + i.valorRecebido, 0),
  }
}

async function buscarDespesas(
  mesRefStr: string,
  erros: string[],
): Promise<{ itens: RelatorioDespesaItem[]; totalPrevisto: number; totalReal: number }> {
  const { data: lista, error } = await supabase
    .from('planejamento')
    .select('id, item, categoria, responsavel, valor_previsto, valor_real, pago, data_vencimento, data_pagamento')
    .eq('mes_referencia', mesRefStr)
    .order('categoria', { ascending: true })

  if (error) {
    console.error('[relatorioMensal] Falha ao buscar despesas:', error)
    erros.push('Não foi possível carregar as despesas.')
  }

  const rows = (lista ?? []) as PlanejamentoRow[]
  const hojeISO = format(new Date(), 'yyyy-MM-dd')

  const itens: RelatorioDespesaItem[] = rows
    .filter(row => !row.item.startsWith(RECEITA_PREFIXO) && row.item !== 'Receita Total')
    .map(row => {
      const vencimento = row.data_vencimento ?? null
      const pago = !!row.pago
      const vencida = !pago && !!vencimento && vencimento < hojeISO

      return {
        id: row.id,
        item: removerPrefixoCartao(row.item),
        categoria: row.categoria ?? '',
        responsavel: row.responsavel ?? '',
        tipo: ehLinhaDeCartao(row.item) ? 'Cartão' : 'Conta',
        status: pago ? 'Pago' : vencida ? 'Vencida' : 'Pendente',
        dataVencimento: vencimento,
        dataPagamento: row.data_pagamento ?? null,
        valorPrevisto: row.valor_previsto ?? 0,
        valorReal: pago ? (row.valor_real ?? row.valor_previsto ?? 0) : null,
      }
    })

  return {
    itens,
    totalPrevisto: itens.reduce((acc, i) => acc + i.valorPrevisto, 0),
    totalReal: itens.reduce((acc, i) => acc + (i.valorReal ?? 0), 0),
  }
}

async function buscarCompras(
  mesRefStr: string,
  erros: string[],
): Promise<{ itens: RelatorioCompraItem[]; total: number }> {
  // select('*') igual à /compras — evita divergência por uma coluna eventualmente
  // não retornável na lista explícita e permite detectar erro real (RLS, etc.)
  // em vez de silenciosamente devolver uma lista vazia.
  const { data, error } = await buscarPaginado<TransacaoRow>((de, ate) =>
    supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', mesRefStr)
      .order('data', { ascending: false })
      .range(de, ate),
  )

  if (error) {
    console.error('[relatorioMensal] Falha ao buscar compras:', error)
    erros.push('Não foi possível carregar as compras do cartão.')
  }

  const itens: RelatorioCompraItem[] = data
    .filter(row => !ehEstorno(row.status))
    .map(row => ({
      id: row.id,
      data: (row.data_compra ?? row.data ?? '').toString().substring(0, 10),
      descricao: row.descricao,
      responsavel: row.responsavel,
      categoria: row.categoria,
      cartao: CARTAO_LABEL[row.cartao ?? 'nubank'] ?? (row.cartao ?? 'NuBank'),
      valor: row.valor,
    }))

  return { itens, total: itens.reduce((acc, i) => acc + i.valor, 0) }
}

async function buscarInvestimentos(
  mesSelecionado: Date,
  mesRefStr: string,
  erros: string[],
): Promise<{ itens: RelatorioInvestimentoItem[]; totalPlanejado: number; totalAportado: number }> {
  const [{ data: invData, error: errorInv }, saldoData] = await Promise.all([
    supabase.from('investimentos').select('id, descricao, percentual').eq('mes_referencia', mesRefStr),
    calcularSaldoInvestimentos(mesSelecionado).catch(err => {
      console.error('[relatorioMensal] Falha ao calcular saldo de investimentos:', err)
      erros.push('Não foi possível calcular o saldo disponível para investimentos.')
      return { saldo: 0, saldoPrevisto: 0 }
    }),
  ])

  if (errorInv) {
    console.error('[relatorioMensal] Falha ao buscar investimentos:', errorInv)
    erros.push('Não foi possível carregar os investimentos cadastrados.')
  }

  const investimentos = (invData ?? []) as InvestimentoRow[]
  const ids = investimentos.map(i => i.id)

  const aportadoPorId: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: aportesData, error: errorAportes } = await supabase
      .from('investimentos_aportes')
      .select('investimento_id, valor')
      .in('investimento_id', ids)
    if (errorAportes) {
      console.error('[relatorioMensal] Falha ao buscar aportes:', errorAportes)
      erros.push('Não foi possível carregar os aportes de investimentos.')
    }
    for (const a of (aportesData ?? []) as AporteRow[]) {
      aportadoPorId[a.investimento_id] = (aportadoPorId[a.investimento_id] ?? 0) + a.valor
    }
  }

  const saldoBase = saldoData.saldoPrevisto > 0 ? saldoData.saldoPrevisto : saldoData.saldo

  const itens: RelatorioInvestimentoItem[] = investimentos.map(inv => ({
    id: inv.id,
    descricao: inv.descricao,
    percentual: inv.percentual,
    valorPlanejado: saldoBase > 0 ? (saldoBase * inv.percentual) / 100 : 0,
    valorAportado: aportadoPorId[inv.id] ?? 0,
  }))

  return {
    itens,
    totalPlanejado: itens.reduce((acc, i) => acc + i.valorPlanejado, 0),
    totalAportado: itens.reduce((acc, i) => acc + i.valorAportado, 0),
  }
}

/**
 * Totais do mês anterior em duas consultas enxutas — o suficiente para as
 * variações dos KPIs, sem repetir o relatório inteiro (que faria ~7 consultas
 * e traria todas as linhas de um mês que ninguém vai abrir).
 *
 * Uma falha aqui não é reportada ao usuário: o relatório do mês pedido segue
 * válido, apenas sem a comparação.
 */
async function buscarComparativo(mesRefStr: string): Promise<ResumoComparativo | null> {
  try {
    const [{ data: plan, error: errPlan }, { data: trans, error: errTrans }] = await Promise.all([
      supabase
        .from('planejamento')
        .select('id, item, valor_previsto, valor_real, pago')
        .eq('mes_referencia', mesRefStr),
      supabase
        .from('transacoes_nubank')
        .select('valor, status')
        .eq('projeto_fatura', mesRefStr),
    ])

    if (errPlan || errTrans) return null

    const rows = (plan ?? []) as PlanejamentoRow[]
    const receitasRows = rows.filter(r => r.item.startsWith(RECEITA_PREFIXO))
    const despesasRows = rows.filter(r => !r.item.startsWith(RECEITA_PREFIXO) && r.item !== 'Receita Total')

    const recebidoPorItem: Record<string, number> = {}
    if (receitasRows.length > 0) {
      const { data: recs } = await supabase
        .from('receitas_recebimentos')
        .select('planejamento_id, valor')
        .in('planejamento_id', receitasRows.map(r => r.id))
      for (const r of (recs ?? []) as RecebimentoRow[]) {
        recebidoPorItem[r.planejamento_id] = (recebidoPorItem[r.planejamento_id] ?? 0) + r.valor
      }
    }

    const receitasRecebidas = receitasRows.reduce((acc, r) => {
      const parcial = recebidoPorItem[r.id]
      if (parcial !== undefined) return acc + parcial
      return acc + (r.pago ? (r.valor_real ?? r.valor_previsto ?? 0) : 0)
    }, 0)

    const despesasReais = despesasRows.reduce(
      (acc, r) => acc + (r.pago ? (r.valor_real ?? r.valor_previsto ?? 0) : 0), 0,
    )

    const comprasTotal = ((trans ?? []) as { valor: number; status: string | null }[])
      .filter(t => !ehEstorno(t.status))
      .reduce((acc, t) => acc + t.valor, 0)

    return {
      receitasRecebidas,
      despesasReais,
      comprasTotal,
      saldoRealizado: receitasRecebidas - despesasReais,
    }
  } catch (err) {
    console.error('[relatorioMensal] Falha ao carregar o mês de comparação:', err)
    return null
  }
}

export async function buscarRelatorioMensal(mesSelecionado: Date): Promise<RelatorioMensal> {
  const inicioMes = startOfMonth(mesSelecionado)
  const mesRefStr = format(inicioMes, 'yyyy-MM-dd')
  const mesAnteriorStr = format(subMonths(inicioMes, 1), 'yyyy-MM-dd')
  const erros: string[] = []

  const [receitas, despesas, compras, investimentos, comparativo] = await Promise.all([
    buscarReceitas(mesRefStr, erros),
    buscarDespesas(mesRefStr, erros),
    buscarCompras(mesRefStr, erros),
    buscarInvestimentos(mesSelecionado, mesRefStr, erros),
    buscarComparativo(mesAnteriorStr),
  ])

  return {
    mesRefStr,
    receitas,
    despesas,
    compras,
    investimentos,
    saldoPrevisto: receitas.totalPrevisto - despesas.totalPrevisto,
    saldoRealizado: receitas.totalRecebido - despesas.totalReal,
    comparativo,
    erros,
  }
}

// ── Agregações e leituras (puras) ──────────────────────────────────────────

/** Despesas somadas por categoria, da maior para a menor. */
export function despesasPorCategoria(itens: RelatorioDespesaItem[]): AgrupamentoRelatorio[] {
  const mapa = new Map<string, AgrupamentoRelatorio>()
  for (const item of itens) {
    const chave = item.categoria || 'Sem categoria'
    const atual = mapa.get(chave) ?? { chave, previsto: 0, realizado: 0, quantidade: 0 }
    atual.previsto += item.valorPrevisto
    atual.realizado += item.valorReal ?? 0
    atual.quantidade += 1
    mapa.set(chave, atual)
  }
  return [...mapa.values()].sort((a, b) => b.previsto - a.previsto)
}

/** Compras do cartão somadas por categoria, da maior para a menor. */
export function comprasPorCategoria(itens: RelatorioCompraItem[]): AgrupamentoRelatorio[] {
  const mapa = new Map<string, AgrupamentoRelatorio>()
  for (const item of itens) {
    const chave = item.categoria || 'Sem categoria'
    const atual = mapa.get(chave) ?? { chave, previsto: 0, realizado: 0, quantidade: 0 }
    atual.realizado += item.valor
    atual.quantidade += 1
    mapa.set(chave, atual)
  }
  return [...mapa.values()].sort((a, b) => b.realizado - a.realizado)
}

/** Compras do cartão somadas por responsável. */
export function comprasPorResponsavel(itens: RelatorioCompraItem[]): AgrupamentoRelatorio[] {
  const mapa = new Map<string, AgrupamentoRelatorio>()
  for (const item of itens) {
    const chave = item.responsavel || 'Conjunto'
    const atual = mapa.get(chave) ?? { chave, previsto: 0, realizado: 0, quantidade: 0 }
    atual.realizado += item.valor
    atual.quantidade += 1
    mapa.set(chave, atual)
  }
  return [...mapa.values()].sort((a, b) => b.realizado - a.realizado)
}

export interface PendenciasMensais {
  pendentes: RelatorioDespesaItem[]
  vencidas: RelatorioDespesaItem[]
  totalPendente: number
  totalVencido: number
  receitasAReceber: number
}

export function pendenciasDoMes(relatorio: RelatorioMensal): PendenciasMensais {
  const naoPagas = relatorio.despesas.itens.filter(i => i.status !== 'Pago')
  const vencidas = naoPagas.filter(i => i.status === 'Vencida')
  return {
    pendentes: naoPagas,
    vencidas,
    totalPendente: naoPagas.reduce((acc, i) => acc + i.valorPrevisto, 0),
    totalVencido: vencidas.reduce((acc, i) => acc + i.valorPrevisto, 0),
    receitasAReceber: relatorio.receitas.itens.reduce(
      (acc, i) => acc + Math.max(0, i.valorPrevisto - i.valorRecebido), 0,
    ),
  }
}

/**
 * Percentual da renda recebida que sobrou depois das despesas pagas.
 * `null` quando ainda não houve receita no mês — 0% seria uma leitura errada.
 */
export function taxaPoupanca(relatorio: RelatorioMensal): number | null {
  if (relatorio.receitas.totalRecebido <= 0) return null
  return (relatorio.saldoRealizado / relatorio.receitas.totalRecebido) * 100
}

/** Itens cujo valor pago mais se afastou do previsto (para cima e para baixo). */
export function maioresDesvios(itens: RelatorioDespesaItem[], quantidade = 3): RelatorioDespesaItem[] {
  return itens
    .filter(i => i.valorReal !== null && i.valorPrevisto > 0)
    .map(i => ({ item: i, desvio: Math.abs((i.valorReal ?? 0) - i.valorPrevisto) }))
    .filter(({ desvio }) => desvio >= 1)
    .sort((a, b) => b.desvio - a.desvio)
    .slice(0, quantidade)
    .map(({ item }) => item)
}

/** Leitura em texto dos números do mês — o que a tabela não conta sozinha. */
export function montarDestaquesMensal(relatorio: RelatorioMensal): Destaque[] {
  const destaques: Destaque[] = []
  const pendencias = pendenciasDoMes(relatorio)
  const poupanca = taxaPoupanca(relatorio)

  if (pendencias.vencidas.length > 0) {
    destaques.push({
      tom: 'negativo',
      titulo: `${pendencias.vencidas.length} conta(s) vencida(s) somando ${formatBRL(pendencias.totalVencido)}`,
      detalhe: pendencias.vencidas.slice(0, 3).map(i => i.item).join(', '),
    })
  }

  if (pendencias.pendentes.length > 0) {
    destaques.push({
      tom: 'atencao',
      titulo: `Falta pagar ${formatBRL(pendencias.totalPendente)} em ${pendencias.pendentes.length} lançamento(s)`,
      detalhe: pendencias.receitasAReceber > 0
        ? `Ainda há ${formatBRL(pendencias.receitasAReceber)} de receita prevista a receber no mês.`
        : undefined,
    })
  }

  if (relatorio.comparativo) {
    const variacao = variacaoPercentual(relatorio.despesas.totalReal, relatorio.comparativo.despesasReais)
    if (variacao !== null && Math.abs(variacao) >= 5) {
      destaques.push({
        tom: variacao > 0 ? 'atencao' : 'positivo',
        titulo: `Despesas pagas ${variacao > 0 ? 'acima' : 'abaixo'} do mês anterior (${formatarVariacao(variacao)})`,
        detalhe: `${formatBRL(relatorio.despesas.totalReal)} contra ${formatBRL(relatorio.comparativo.despesasReais)} no mês passado.`,
      })
    }
  }

  const topCategoria = despesasPorCategoria(relatorio.despesas.itens)[0]
  if (topCategoria && relatorio.despesas.totalPrevisto > 0) {
    destaques.push({
      tom: 'neutro',
      titulo: `Maior categoria: ${topCategoria.chave} (${formatBRL(topCategoria.previsto)})`,
      detalhe: `Representa ${formatarPercentual((topCategoria.previsto / relatorio.despesas.totalPrevisto) * 100, 0)} das despesas previstas do mês.`,
    })
  }

  const desvio = maioresDesvios(relatorio.despesas.itens, 1)[0]
  if (desvio && desvio.valorReal !== null) {
    const diferenca = desvio.valorReal - desvio.valorPrevisto
    destaques.push({
      tom: diferenca > 0 ? 'atencao' : 'positivo',
      titulo: `${desvio.item} ficou ${formatBRL(Math.abs(diferenca))} ${diferenca > 0 ? 'acima' : 'abaixo'} do previsto`,
      detalhe: `Previsto ${formatBRL(desvio.valorPrevisto)} · pago ${formatBRL(desvio.valorReal)}.`,
    })
  }

  if (poupanca !== null) {
    destaques.push({
      tom: poupanca >= 20 ? 'positivo' : poupanca >= 0 ? 'neutro' : 'negativo',
      titulo: `Taxa de poupança do mês: ${formatarPercentual(poupanca, 1)}`,
      detalhe: poupanca < 0
        ? 'As despesas pagas superaram o que entrou no mês.'
        : `Sobrou ${formatBRL(relatorio.saldoRealizado)} do que já foi recebido.`,
    })
  }

  return destaques
}

// ── Documento exportado ────────────────────────────────────────────────────

export function montarDocumentoMensal(relatorio: RelatorioMensal, mes: Date): DocumentoRelatorio {
  const pendencias = pendenciasDoMes(relatorio)
  const poupanca = taxaPoupanca(relatorio)

  return {
    titulo: 'Relatório Gerencial Mensal',
    subtitulo: `Período: ${formatarMesLongo(mes)}`,
    nomeArquivo: `relatorio-${format(mes, 'yyyy-MM')}`,
    avisos: relatorio.erros,
    resumo: [
      { label: 'Receitas recebidas', valor: relatorio.receitas.totalRecebido },
      { label: 'Despesas pagas', valor: relatorio.despesas.totalReal },
      { label: 'Saldo realizado', valor: relatorio.saldoRealizado },
      { label: 'Saldo previsto', valor: relatorio.saldoPrevisto },
      { label: 'A pagar', valor: pendencias.totalPendente },
      { label: 'Taxa de poupança', valor: poupanca === null ? '—' : formatarPercentual(poupanca, 1) },
    ],
    secoes: [
      {
        titulo: 'Receitas',
        explicacao: RELATORIO_EXPLICACOES.receitas,
        colunas: ['Item', 'Responsável', 'Status', 'Previsto', 'Recebido'],
        linhas: relatorio.receitas.itens.map(i => [
          i.item, i.responsavel, i.pago ? 'Recebido' : 'Pendente', i.valorPrevisto, i.valorRecebido,
        ]),
        totais: [
          { label: 'Previsto', valor: relatorio.receitas.totalPrevisto },
          { label: 'Recebido', valor: relatorio.receitas.totalRecebido },
        ],
      },
      {
        titulo: 'Despesas',
        explicacao: RELATORIO_EXPLICACOES.despesas,
        colunas: ['Item', 'Categoria', 'Tipo', 'Status', 'Vencimento', 'Previsto', 'Real'],
        linhas: relatorio.despesas.itens.map(i => [
          i.item,
          i.categoria,
          i.tipo,
          i.status,
          i.dataVencimento ? formatarData(i.dataVencimento) : '—',
          i.valorPrevisto,
          i.valorReal !== null ? i.valorReal : '—',
        ]),
        totais: [
          { label: 'Previsto', valor: relatorio.despesas.totalPrevisto },
          { label: 'Real', valor: relatorio.despesas.totalReal },
          { label: 'A pagar', valor: pendencias.totalPendente },
        ],
      },
      {
        titulo: 'Despesas por categoria',
        explicacao: RELATORIO_EXPLICACOES.categorias,
        colunas: ['Categoria', 'Lançamentos', 'Previsto', 'Pago'],
        linhas: despesasPorCategoria(relatorio.despesas.itens).map(c => [
          c.chave, String(c.quantidade), c.previsto, c.realizado,
        ]),
      },
      {
        titulo: 'Compras no cartão',
        explicacao: RELATORIO_EXPLICACOES.compras,
        colunas: ['Data', 'Descrição', 'Responsável', 'Cartão', 'Categoria', 'Valor'],
        linhas: relatorio.compras.itens.map(i => [
          formatarData(i.data), i.descricao, i.responsavel, i.cartao, i.categoria ?? '', i.valor,
        ]),
        totais: [{ label: 'Total', valor: relatorio.compras.total }],
      },
      {
        titulo: 'Investimentos',
        explicacao: RELATORIO_EXPLICACOES.investimentos,
        colunas: ['Descrição', 'Percentual', 'Planejado', 'Aportado'],
        linhas: relatorio.investimentos.itens.map(i => [
          i.descricao, `${i.percentual}%`, i.valorPlanejado, i.valorAportado,
        ]),
        totais: [
          { label: 'Planejado', valor: relatorio.investimentos.totalPlanejado },
          { label: 'Aportado', valor: relatorio.investimentos.totalAportado },
        ],
      },
      {
        titulo: 'Destaques do período',
        colunas: ['Leitura'],
        linhas: montarDestaquesMensal(relatorio).map(d => [
          d.detalhe ? `${d.titulo} — ${d.detalhe}` : d.titulo,
        ]),
        vazio: 'Sem destaques para este mês.',
      },
    ],
    notaRodape:
      'Compras já estão refletidas na fatura do cartão em Despesas. Investimentos representam valores destinados a partir do saldo do mês.',
  }
}
