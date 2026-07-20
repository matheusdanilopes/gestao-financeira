import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'

export interface SaldoData {
  saldo: number
  saldoPrevisto: number
}

function isNuBankItem(item: string): boolean {
  const lower = item.trim().toLowerCase()
  return lower === 'nubank matheus' || lower === 'nubank jeniffer' ||
         lower === 'nubank jeniffer conjunto' || lower === 'nubank conjunto'
}

export async function calcularSaldoInvestimentos(mes: Date): Promise<SaldoData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [{ data: transacoesFatura }, { data: planejamento }] = await Promise.all([
    supabase.from('transacoes_nubank').select('valor, responsavel, cartao').eq('projeto_fatura', mesRefFatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO'),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
  ])

  function findNuBank(name: string) {
    return planejamento?.find((p: { item: string }) => p.item.trim().toLowerCase() === name)
  }

  const txNubank = (transacoesFatura || []).filter(t => !t.cartao || t.cartao === 'nubank')
  const txC1 = (transacoesFatura || []).filter(t => t.cartao === 'cartao1')
  const txC2 = (transacoesFatura || []).filter(t => t.cartao === 'cartao2')

  const receitaBase = planejamento?.find(p => p.item === 'Receita Total')?.valor_previsto || 0
  const receitasExtras = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[RECEITA]'))
    .reduce((acc, p) => acc + p.valor_previsto, 0)
  const receitaTotal = receitaBase + receitasExtras

  let contasFixas = 0
  let contasFixasPrevisto = 0
  for (const p of (planejamento || [])) {
    const item = typeof p.item === 'string' ? p.item : ''
    if (item.startsWith('[RECEITA]') || item === 'Receita Total' ||
        isNuBankItem(item) || item.startsWith('[CARTAO1]') || item.startsWith('[CARTAO2]')) continue
    const prev = p.valor_previsto || 0
    contasFixas += p.pago ? (p.valor_real ?? prev) : prev
    contasFixasPrevisto += prev
  }

  const matheusPrevisto = findNuBank('nubank matheus')?.valor_previsto || 0
  const jenifferPrevisto =
    (findNuBank('nubank jeniffer')?.valor_previsto || 0) +
    (findNuBank('nubank jeniffer conjunto')?.valor_previsto || 0)
  const conjuntoPrevisto = findNuBank('nubank conjunto')?.valor_previsto || 0
  const nuBankPrevisto = matheusPrevisto + jenifferPrevisto + conjuntoPrevisto

  const cartao1PrevTotal = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)
  const cartao2PrevTotal = (planejamento || [])
    .filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))
    .reduce((acc, p) => acc + (p.valor_previsto || 0), 0)

  const nubankMatheusRow = findNuBank('nubank matheus')
  const nubankJenifferRow = findNuBank('nubank jeniffer')
  const nubankJenifferConjRow = findNuBank('nubank jeniffer conjunto')
  const nubankConjuntoRow = findNuBank('nubank conjunto')

  const matheusAtual = txNubank.filter(t => t.responsavel === 'Matheus').reduce((acc, t) => acc + t.valor, 0)
  const jenifferAtual = txNubank.filter(t => t.responsavel === 'Jeniffer').reduce((acc, t) => acc + t.valor, 0)
  const conjuntoAtual = txNubank.filter(t => t.responsavel === 'Conjunto').reduce((acc, t) => acc + t.valor, 0)
  const totalC1Atual = txC1.reduce((acc, t) => acc + t.valor, 0)
  const totalC2Atual = txC2.reduce((acc, t) => acc + t.valor, 0)

  const nubankMatheusEfetivo = nubankMatheusRow?.pago
    ? (nubankMatheusRow.valor_real ?? nubankMatheusRow.valor_previsto)
    : matheusAtual > 0 ? matheusAtual : matheusPrevisto

  const jenifferNubankPago = !!(nubankJenifferRow?.pago || nubankJenifferConjRow?.pago)
  const nubankJenifferEfetivo = jenifferNubankPago
    ? ((nubankJenifferRow?.pago ? (nubankJenifferRow.valor_real ?? nubankJenifferRow.valor_previsto) : 0) +
       (nubankJenifferConjRow?.pago ? (nubankJenifferConjRow.valor_real ?? nubankJenifferConjRow.valor_previsto) : 0))
    : jenifferAtual > 0 ? jenifferAtual : jenifferPrevisto

  const cartao1PaidRows = (planejamento || []).filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]') && p.pago)
  const cartao1Efetivo = cartao1PaidRows.length > 0
    ? cartao1PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : totalC1Atual > 0 ? totalC1Atual : cartao1PrevTotal

  const cartao2PaidRows = (planejamento || []).filter(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]') && p.pago)
  const cartao2Efetivo = cartao2PaidRows.length > 0
    ? cartao2PaidRows.reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)
    : totalC2Atual > 0 ? totalC2Atual : cartao2PrevTotal

  const conjuntoEfetivo = nubankConjuntoRow?.pago
    ? (nubankConjuntoRow.valor_real ?? conjuntoPrevisto)
    : conjuntoAtual > 0 ? conjuntoAtual : conjuntoPrevisto
  const faturaEfetiva = nubankMatheusEfetivo + nubankJenifferEfetivo + conjuntoEfetivo + cartao1Efetivo + cartao2Efetivo
  const totalGastos = contasFixas + faturaEfetiva

  return {
    saldo: receitaTotal - totalGastos,
    saldoPrevisto: receitaTotal - contasFixasPrevisto - nuBankPrevisto - cartao1PrevTotal - cartao2PrevTotal,
  }
}
