import { format, startOfMonth } from 'date-fns'
import { supabase } from './supabaseClient'

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
  valor: number
  pago: boolean
}

export interface RelatorioDespesaItem {
  id: string
  item: string
  categoria: string
  status: 'Pago' | 'Pendente'
  valor: number
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
  data: string
  descricao: string
  observacao: string | null
  valor: number
}

export interface RelatorioMensal {
  mesRefStr: string
  receitas: { itens: RelatorioReceitaItem[]; total: number }
  despesas: { itens: RelatorioDespesaItem[]; total: number }
  compras: { itens: RelatorioCompraItem[]; total: number }
  investimentos: { itens: RelatorioInvestimentoItem[]; total: number }
  saldoMes: number
}

export const RELATORIO_EXPLICACOES = {
  receitas: 'Valores recebidos no mês: salário, freelas e outras entradas de dinheiro.',
  despesas: 'Contas e gastos fixos ou variáveis do mês, pagos ou pendentes.',
  compras: 'Compras feitas no cartão de crédito que entraram na fatura deste mês (estornos não são contabilizados).',
  investimentos: 'Valores aportados no mês em investimentos e reservas financeiras.',
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
}

type AporteRow = {
  investimento_id: string
  valor: number
  data_aporte: string
  observacao: string | null
}

async function buscarReceitas(mesRefStr: string): Promise<{ itens: RelatorioReceitaItem[]; total: number }> {
  const { data: lista } = await supabase
    .from('planejamento')
    .select('id, item, responsavel, valor_previsto, valor_real, pago')
    .eq('mes_referencia', mesRefStr)
    .ilike('item', '[RECEITA]%')
    .order('item', { ascending: true })

  const rows = (lista ?? []) as PlanejamentoRow[]
  const ids = rows.map(r => r.id)

  const recebimentosPorItem: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: recs } = await supabase
      .from('receitas_recebimentos')
      .select('planejamento_id, valor')
      .in('planejamento_id', ids)
    for (const r of (recs ?? []) as RecebimentoRow[]) {
      recebimentosPorItem[r.planejamento_id] = (recebimentosPorItem[r.planejamento_id] ?? 0) + r.valor
    }
  }

  const itens: RelatorioReceitaItem[] = rows.map(row => {
    const totalRecebido = recebimentosPorItem[row.id]
    const valor = totalRecebido !== undefined
      ? totalRecebido
      : row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : 0

    return {
      id: row.id,
      item: row.item.startsWith(RECEITA_PREFIXO) ? row.item.replace(RECEITA_PREFIXO, '') : row.item,
      responsavel: row.responsavel ?? '',
      valor,
      pago: !!row.pago,
    }
  })

  return { itens, total: itens.reduce((acc, i) => acc + i.valor, 0) }
}

async function buscarDespesas(mesRefStr: string): Promise<{ itens: RelatorioDespesaItem[]; total: number }> {
  const { data: lista } = await supabase
    .from('planejamento')
    .select('id, item, categoria, valor_previsto, valor_real, pago')
    .eq('mes_referencia', mesRefStr)
    .order('categoria', { ascending: true })

  const rows = (lista ?? []) as PlanejamentoRow[]

  const itens: RelatorioDespesaItem[] = rows
    .filter(row => !row.item.startsWith(RECEITA_PREFIXO) && row.item !== 'Receita Total')
    .map(row => ({
      id: row.id,
      item: removerPrefixoCartao(row.item),
      categoria: row.categoria ?? '',
      status: row.pago ? 'Pago' : 'Pendente',
      valor: row.pago ? (row.valor_real ?? row.valor_previsto ?? 0) : (row.valor_previsto ?? 0),
    }))

  return { itens, total: itens.reduce((acc, i) => acc + i.valor, 0) }
}

async function buscarCompras(mesRefStr: string): Promise<{ itens: RelatorioCompraItem[]; total: number }> {
  const { data } = await supabase
    .from('transacoes_nubank')
    .select('id, data_compra, data, descricao, responsavel, categoria, valor, status')
    .eq('projeto_fatura', mesRefStr)
    .order('data', { ascending: false })

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

async function buscarInvestimentos(mesRefStr: string): Promise<{ itens: RelatorioInvestimentoItem[]; total: number }> {
  const { data: invData } = await supabase
    .from('investimentos')
    .select('id, descricao')
    .eq('mes_referencia', mesRefStr)

  const investimentos = (invData ?? []) as InvestimentoRow[]
  const ids = investimentos.map(i => i.id)
  const descricaoPorId: Record<string, string> = {}
  for (const inv of investimentos) descricaoPorId[inv.id] = inv.descricao

  let itens: RelatorioInvestimentoItem[] = []
  if (ids.length > 0) {
    const { data: aportesData } = await supabase
      .from('investimentos_aportes')
      .select('investimento_id, valor, data_aporte, observacao')
      .in('investimento_id', ids)
      .order('data_aporte', { ascending: true })

    itens = ((aportesData ?? []) as AporteRow[]).map((aporte, idx) => ({
      id: `${aporte.investimento_id}-${idx}`,
      data: aporte.data_aporte,
      descricao: descricaoPorId[aporte.investimento_id] ?? '',
      observacao: aporte.observacao,
      valor: aporte.valor,
    }))
  }

  return { itens, total: itens.reduce((acc, i) => acc + i.valor, 0) }
}

export async function buscarRelatorioMensal(mesSelecionado: Date): Promise<RelatorioMensal> {
  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')

  const [receitas, despesas, compras, investimentos] = await Promise.all([
    buscarReceitas(mesRefStr),
    buscarDespesas(mesRefStr),
    buscarCompras(mesRefStr),
    buscarInvestimentos(mesRefStr),
  ])

  return {
    mesRefStr,
    receitas,
    despesas,
    compras,
    investimentos,
    saldoMes: receitas.total - despesas.total,
  }
}
