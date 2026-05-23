// Standalone async fetchers for background pre-caching.
// Each function mirrors the fetcher defined in its corresponding page/component.
// They are intentionally kept in sync — update here if you change a component's fetcher.

import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'

const NUBANK_ITEMS = new Set(['NuBank Matheus', 'NuBank Jeniffer', 'NuBank Jeniffer Conjunto'])

/** Mirrors calcularSaldo() in app/financas/page.tsx — cacheKey: investimentos-saldo:YYYY-MM */
export async function prefetchSaldo(mes: Date) {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [{ data: transacoesFatura }, { data: planejamento }] = await Promise.all([
    supabase.from('transacoes_nubank').select('valor, responsavel, cartao').eq('projeto_fatura', mesRefFatura),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
  ])

  const txNubank = (transacoesFatura || []).filter((t: { cartao: string }) => !t.cartao || t.cartao === 'nubank')
  const txC1    = (transacoesFatura || []).filter((t: { cartao: string }) => t.cartao === 'cartao1')
  const txC2    = (transacoesFatura || []).filter((t: { cartao: string }) => t.cartao === 'cartao2')

  type PlanRow = { item: string; valor_previsto: number; valor_real: number | null; pago: boolean; responsavel?: string }
  const plan = (planejamento || []) as PlanRow[]

  const receitaBase   = plan.find(p => p.item === 'Receita Total')?.valor_previsto || 0
  const receitasExtras = plan.filter(p => p.item.startsWith('[RECEITA]')).reduce((a, p) => a + p.valor_previsto, 0)
  const receitaTotal  = receitaBase + receitasExtras

  let contasFixas = 0, contasFixasPrevisto = 0
  for (const p of plan) {
    const { item } = p
    if (item.startsWith('[RECEITA]') || item === 'Receita Total' ||
        NUBANK_ITEMS.has(item) || item.startsWith('[CARTAO1]') || item.startsWith('[CARTAO2]')) continue
    const prev = p.valor_previsto || 0
    contasFixas += p.pago ? (p.valor_real ?? prev) : prev
    contasFixasPrevisto += prev
  }

  const matheusPrevisto  = plan.find(p => p.item === 'NuBank Matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (plan.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto || 0) +
    (plan.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto || 0)
  const nuBankPrevisto   = matheusPrevisto + jenifferPrevisto

  const cartao1PrevTotal = plan.filter(p => p.item.startsWith('[CARTAO1]')).reduce((a, p) => a + (p.valor_previsto || 0), 0)
  const cartao2PrevTotal = plan.filter(p => p.item.startsWith('[CARTAO2]')).reduce((a, p) => a + (p.valor_previsto || 0), 0)

  const nubankMatheusRow      = plan.find(p => p.item === 'NuBank Matheus')
  const nubankJenifferRow     = plan.find(p => p.item === 'NuBank Jeniffer')
  const nubankJenifferConjRow = plan.find(p => p.item === 'NuBank Jeniffer Conjunto')

  type TxRow = { responsavel: string; valor: number }
  const matheusAtual = (txNubank as TxRow[]).filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const jenifferAtual = (txNubank as TxRow[]).filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)
  const totalC1Atual  = (txC1 as TxRow[]).reduce((a, t) => a + t.valor, 0)
  const totalC2Atual  = (txC2 as TxRow[]).reduce((a, t) => a + t.valor, 0)

  const nubankMatheusEfetivo = nubankMatheusRow?.pago
    ? (nubankMatheusRow.valor_real ?? nubankMatheusRow.valor_previsto)
    : matheusAtual > 0 ? matheusAtual : matheusPrevisto

  const jenifferNubankPago = !!(nubankJenifferRow?.pago || nubankJenifferConjRow?.pago)
  const nubankJenifferEfetivo = jenifferNubankPago
    ? ((nubankJenifferRow?.pago ? (nubankJenifferRow.valor_real ?? nubankJenifferRow.valor_previsto) : 0) +
       (nubankJenifferConjRow?.pago ? (nubankJenifferConjRow.valor_real ?? nubankJenifferConjRow.valor_previsto) : 0))
    : jenifferAtual > 0 ? jenifferAtual : jenifferPrevisto

  const cartao1PaidRows = plan.filter(p => p.item.startsWith('[CARTAO1]') && p.pago)
  const cartao1Efetivo  = cartao1PaidRows.length > 0
    ? cartao1PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : totalC1Atual > 0 ? totalC1Atual : cartao1PrevTotal

  const cartao2PaidRows = plan.filter(p => p.item.startsWith('[CARTAO2]') && p.pago)
  const cartao2Efetivo  = cartao2PaidRows.length > 0
    ? cartao2PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : totalC2Atual > 0 ? totalC2Atual : cartao2PrevTotal

  const faturaEfetiva = nubankMatheusEfetivo + nubankJenifferEfetivo + cartao1Efetivo + cartao2Efetivo
  const totalGastos   = contasFixas + faturaEfetiva

  return {
    saldo:         receitaTotal - totalGastos,
    saldoPrevisto: receitaTotal - contasFixasPrevisto - nuBankPrevisto - cartao1PrevTotal - cartao2PrevTotal,
  }
}

/** Mirrors fetcherCompras in app/compras/page.tsx — cacheKey: compras:YYYY-MM-DD
 *  mesRefStr = format(startOfMonth(addMonths(globalMes, 1)), 'yyyy-MM-dd')
 */
export async function prefetchCompras(mesRefStr: string) {
  const { data } = await supabase
    .from('transacoes_nubank')
    .select('*')
    .eq('projeto_fatura', mesRefStr)
    .order('data', { ascending: false })
  return data || []
}

/** Mirrors fetcherItens in components/ChecklistMensal.tsx — cacheKey: checklist:YYYY-MM-DD */
export async function prefetchChecklist(mesRefStr: string) {
  const { data } = await supabase
    .from('planejamento')
    .select('*')
    .eq('mes_referencia', mesRefStr)
    .not('item', 'ilike', '[RECEITA]%')
    .order('categoria', { ascending: false })
  return data || []
}

/** Mirrors fetcherReceitas in components/ReceitasMensal.tsx — cacheKey: receitas:YYYY-MM-DD */
export async function prefetchReceitas(mesRefStr: string) {
  const { data: lista } = await supabase
    .from('planejamento')
    .select('*')
    .eq('mes_referencia', mesRefStr)
    .ilike('item', '[RECEITA]%')
    .order('item', { ascending: true })
  const itensList = lista || []
  const ids = (itensList as Array<{ id: string }>).map(i => i.id)
  const recsMap: Record<string, unknown[]> = {}
  if (ids.length > 0) {
    const { data: recs } = await supabase
      .from('receitas_recebimentos')
      .select('*')
      .in('planejamento_id', ids)
      .order('data_recebimento', { ascending: true })
    for (const r of (recs || []) as Array<{ planejamento_id: string }>) {
      if (!recsMap[r.planejamento_id]) recsMap[r.planejamento_id] = []
      recsMap[r.planejamento_id].push(r)
    }
  }
  return { itens: itensList, recebimentos: recsMap }
}

/** Mirrors fetcherInvestimentos in components/InvestimentosMensal.tsx — cacheKey: investimentos:YYYY-MM-DD */
export async function prefetchInvestimentos(mesRefStr: string) {
  const { data: invData } = await supabase
    .from('investimentos')
    .select('*')
    .eq('mes_referencia', mesRefStr)
    .order('created_at', { ascending: true })
  const ids = (invData || []).map((i: { id: string }) => i.id)
  const aportesMap: Record<string, unknown[]> = {}
  if (ids.length > 0) {
    const { data: aportesData } = await supabase
      .from('investimentos_aportes')
      .select('*')
      .in('investimento_id', ids)
      .order('data_aporte', { ascending: true })
    for (const a of (aportesData || []) as Array<{ investimento_id: string }>) {
      if (!aportesMap[a.investimento_id]) aportesMap[a.investimento_id] = []
      aportesMap[a.investimento_id].push(a)
    }
  }
  return { itens: invData || [], aportes: aportesMap }
}

/** Mirrors fetcher in components/AssinaturasMensal.tsx — cacheKey: assinaturas:YYYY-MM-DD
 *  nextMesRefStr = format(startOfMonth(addMonths(mesSelecionado, 1)), 'yyyy-MM-dd')
 */
export async function prefetchAssinaturas(mesRefStr: string, nextMesRefStr: string) {
  const [
    { data: assinaturasData },
    { data: transacoesData },
    { data: planejamentoData },
    { data: historicoData },
  ] = await Promise.all([
    supabase.from('assinaturas').select('*').order('nome', { ascending: true }),
    supabase.from('transacoes_nubank').select('descricao, valor, cartao, projeto_fatura').eq('projeto_fatura', nextMesRefStr),
    supabase.from('planejamento').select('item').eq('mes_referencia', mesRefStr),
    supabase.from('assinaturas_historico').select('*').order('vigente_desde', { ascending: true }),
  ])
  const c1 = (planejamentoData || []).find((p: { item: string }) => p.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
  const c2 = (planejamentoData || []).find((p: { item: string }) => p.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()
  return {
    assinaturas:  assinaturasData  || [],
    transacoes:   transacoesData   || [],
    historico:    historicoData    || [],
    cartaoLabels: { nubank: 'NuBank', cartao1: c1 || 'Cartão 1', cartao2: c2 || 'Cartão 2' },
  }
}
