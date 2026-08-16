import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'
import {
  calcularResumoSaldo,
  type PlanejamentoSaldoRow,
  type TransacaoSaldoRow,
} from '@/lib/faturaEfetiva'

export interface SaldoData {
  saldo: number
  saldoPrevisto: number
}

export async function calcularSaldoInvestimentos(mes: Date): Promise<SaldoData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [{ data: transacoesFatura }, { data: planejamento }] = await Promise.all([
    // Traz status e conciliacao_ref em vez de filtrar ESTORNO no SQL: somarValorFatura
    // precisa deles para descontar estorno sem par (crédito que não casou com a compra
    // original). Antes este arquivo filtrava no SQL e divergia do Dashboard.
    supabase
      .from('transacoes_nubank')
      .select('valor, responsavel, cartao, status, conciliacao_ref')
      .eq('projeto_fatura', mesRefFatura),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
  ])

  const resumo = calcularResumoSaldo(
    (planejamento || []) as PlanejamentoSaldoRow[],
    (transacoesFatura || []) as TransacaoSaldoRow[]
  )

  return { saldo: resumo.saldo, saldoPrevisto: resumo.saldoPrevisto }
}
