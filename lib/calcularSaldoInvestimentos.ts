import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'
import {
  calcularResumoSaldo,
  transacoesDoCartao,
  type PlanejamentoSaldoRow,
  type TransacaoSaldoRow,
} from '@/lib/faturaEfetiva'
import { calcularPendentesFatura, type AssinaturaPendenteRow, type TransacaoPendenteRow } from '@/lib/pendentesFatura'
import type { BaixaReserva, ReservaFatura } from '@/lib/reservasFatura'

export interface SaldoData {
  saldo: number
  saldoPrevisto: number
}

export async function calcularSaldoInvestimentos(mes: Date): Promise<SaldoData> {
  const primeiroDia = startOfMonth(mes)
  const mesRef = format(primeiroDia, 'yyyy-MM-dd')
  const mesRefFatura = format(startOfMonth(addMonths(mes, 1)), 'yyyy-MM-dd')

  const [
    { data: transacoesFatura },
    { data: planejamento },
    { data: assinaturas },
    { data: historico },
    { data: reservas },
    { data: baixas },
  ] = await Promise.all([
    // Traz status e conciliacao_ref em vez de filtrar ESTORNO no SQL: somarValorFatura
    // precisa deles para descontar estorno sem par (crédito que não casou com a compra
    // original). Antes este arquivo filtrava no SQL e divergia do Dashboard.
    // descricao/parcelas: identificam as assinaturas e compras previstas já lançadas.
    supabase
      .from('transacoes_nubank')
      .select('valor, responsavel, descricao, cartao, parcela_atual, total_parcelas, status, conciliacao_ref')
      .eq('projeto_fatura', mesRefFatura),
    supabase.from('planejamento').select('*').eq('mes_referencia', mesRef),
    // Mesmas consultas do Dashboard: o saldo desconta o que ainda vai cair na fatura.
    supabase.from('assinaturas').select('id, nome, valor, responsavel, ativa, moeda, dia_cobranca').eq('cartao', 'nubank'),
    supabase.from('assinaturas_historico').select('assinatura_id, valor, vigente_desde, criado_em'),
    supabase.from('reservas_fatura').select('id, descricao, valor, responsavel, recorrente, mes_inicio, mes_fim, palavras_chave, parcelas, created_at')
      .lte('mes_inicio', mesRef).or(`mes_fim.is.null,mes_fim.gte.${mesRef}`),
    supabase.from('reservas_fatura_baixas').select('reserva_id, mes_referencia').lte('mes_referencia', mesRef),
  ])

  const transacoes = (transacoesFatura || []) as (TransacaoSaldoRow & TransacaoPendenteRow)[]
  const pendentes = calcularPendentesFatura({
    mes,
    assinaturas: (assinaturas || []) as AssinaturaPendenteRow[],
    historico: historico || [],
    transacoes: transacoesDoCartao(transacoes, 'principal'),
    reservas: (reservas || []) as ReservaFatura[],
    baixas: (baixas || []) as BaixaReserva[],
  })

  const resumo = calcularResumoSaldo(
    (planejamento || []) as PlanejamentoSaldoRow[],
    transacoes,
    pendentes.total
  )

  return { saldo: resumo.saldo, saldoPrevisto: resumo.saldoPrevisto }
}
