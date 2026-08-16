// Standalone async fetchers for background pre-caching.
// Each function mirrors the fetcher defined in its corresponding page/component.
// They are intentionally kept in sync — update here if you change a component's fetcher.

import { supabase } from '@/lib/supabaseClient'
import { calcularSaldoInvestimentos } from '@/lib/calcularSaldoInvestimentos'

/** Mirrors calcularSaldo() in app/financas/page.tsx — cacheKey: investimentos-saldo:YYYY-MM
 *  A conta em si vive em calcularSaldoInvestimentos: este arquivo já manteve uma
 *  segunda cópia dela, que divergiu do Dashboard no tratamento de estornos.
 */
export const prefetchSaldo = calcularSaldoInvestimentos

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
