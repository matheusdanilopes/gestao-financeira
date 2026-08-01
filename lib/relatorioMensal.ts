import { format, startOfMonth } from 'date-fns'
import { supabase } from './supabaseClient'
import { calcularSaldoInvestimentos } from './calcularSaldoInvestimentos'

const RECEITA_PREFIXO = '[RECEITA] '
const PREFIXO_CARTAO_1 = '[CARTAO1] '
const PREFIXO_CARTAO_2 = '[CARTAO2] '

function removerPrefixoCartao(item: string) {
  return item.replace(PREFIXO_CARTAO_1, '').replace(PREFIXO_CARTAO_2, '')
}

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
  status: 'Pago' | 'Pendente'
  valorPrevisto: number
  valorReal: number | null
}

export interface RelatorioCompraItem {
  id: string
  data: string
  descricao: string
  responsavel: string
  categoria: string | null
  valor: number
}

export interface RelatorioInvestimentoItem {
  id: string
  descricao: string
  percentual: number
  valorPlanejado: number
  valorAportado: number
}

export interface RelatorioMensal {
  mesRefStr: string
  receitas: { itens: RelatorioReceitaItem[]; totalPrevisto: number; totalRecebido: number }
  despesas: { itens: RelatorioDespesaItem[]; totalPrevisto: number; totalReal: number }
  compras: { itens: RelatorioCompraItem[]; total: number }
  investimentos: { itens: RelatorioInvestimentoItem[]; totalPlanejado: number; totalAportado: number }
  saldoPrevisto: number
  saldoRealizado: number
  erros: string[]
}

export const RELATORIO_EXPLICACOES = {
  receitas: 'Valores previstos e recebidos no mês: salário, freelas e outras entradas de dinheiro.',
  despesas: 'Contas e gastos previstos no mês, fixos ou variáveis, pagos ou pendentes.',
  compras: 'Compras feitas no cartão de crédito que entraram na fatura deste mês (estornos não são contabilizados).',
  investimentos: 'Valor planejado (percentual sobre o saldo do mês) e valor efetivamente aportado em cada investimento.',
} as const

type PlanejamentoRow = {
  id: string
  item: string
  responsavel: string | null
  categoria: string | null
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean | null
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
    .select('id, item, categoria, valor_previsto, valor_real, pago')
    .eq('mes_referencia', mesRefStr)
    .order('categoria', { ascending: true })

  if (error) {
    console.error('[relatorioMensal] Falha ao buscar despesas:', error)
    erros.push('Não foi possível carregar as despesas.')
  }

  const rows = (lista ?? []) as PlanejamentoRow[]

  const itens: RelatorioDespesaItem[] = rows
    .filter(row => !row.item.startsWith(RECEITA_PREFIXO) && row.item !== 'Receita Total')
    .map(row => ({
      id: row.id,
      item: removerPrefixoCartao(row.item),
      categoria: row.categoria ?? '',
      status: row.pago ? 'Pago' : 'Pendente',
      valorPrevisto: row.valor_previsto ?? 0,
      valorReal: row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : null,
    }))

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
  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('*')
    .eq('projeto_fatura', mesRefStr)
    .order('data', { ascending: false })

  if (error) {
    console.error('[relatorioMensal] Falha ao buscar compras:', error)
    erros.push('Não foi possível carregar as compras do cartão.')
  }

  const rows = (data ?? []) as TransacaoRow[]

  const itens: RelatorioCompraItem[] = rows
    .filter(row => row.status !== 'ESTORNO' && row.status !== 'ESTORNADO')
    .map(row => ({
      id: row.id,
      data: (row.data_compra ?? row.data ?? '').toString().substring(0, 10),
      descricao: row.descricao,
      responsavel: row.responsavel,
      categoria: row.categoria,
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

export async function buscarRelatorioMensal(mesSelecionado: Date): Promise<RelatorioMensal> {
  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
  const erros: string[] = []

  const [receitas, despesas, compras, investimentos] = await Promise.all([
    buscarReceitas(mesRefStr, erros),
    buscarDespesas(mesRefStr, erros),
    buscarCompras(mesRefStr, erros),
    buscarInvestimentos(mesSelecionado, mesRefStr, erros),
  ])

  return {
    mesRefStr,
    receitas,
    despesas,
    compras,
    investimentos,
    saldoPrevisto: receitas.totalPrevisto - despesas.totalPrevisto,
    saldoRealizado: receitas.totalRecebido - despesas.totalReal,
    erros,
  }
}
