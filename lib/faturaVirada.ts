import { SupabaseClient } from '@supabase/supabase-js'
import { TransacaoNubank } from '@/lib/csvparser'
import { estaNosUltimosDoisDiasDoCiclo, proximaFatura } from '@/lib/fatura'

/**
 * Corrige, apenas na PRIMEIRA importação de cada fatura, as compras dos 2
 * últimos dias do ciclo que a fórmula colocou na fatura errada em relação ao
 * fechamento real cadastrado manualmente (Configurações → Faturas). É
 * exatamente a janela em que o NuBank pode fechar 1-2 dias antes do
 * estimado e "migrar" uma compra do último dia para a fatura seguinte,
 * gerando divergência entre o valor do NuBank e o do app.
 *
 * Só corrige quando as três condições valem para a transação:
 * - é a PRIMEIRA importação daquela fatura (nenhuma transação prévia no
 *   banco com esse projeto_fatura + cartao) — reimportações não voltam a
 *   mexer na classificação, mesmo que o usuário reimporte o mesmo extrato;
 * - a compra caiu nos 2 últimos dias do ciclo calculado pela fórmula;
 * - existe uma data de fechamento real cadastrada para essa fatura e a
 *   compra já bateu (ou passou) esse fechamento — só então ela migra para a
 *   fatura seguinte.
 *
 * Muda apenas `projeto_fatura` nos objetos passados (mutação in-place, os
 * mesmos objetos referenciados pelo array `transacoes` do chamador);
 * `data_compra` e o hash de deduplicação não são tocados.
 *
 * Precisa ser chamada ANTES do lote ser inserido no banco (a contagem de
 * "primeira importação" reflete o estado atual da tabela).
 */
export async function corrigirComprasDaViradaNaPrimeiraImportacao(
  supabase: SupabaseClient,
  transacoes: TransacaoNubank[],
  cartao: string,
  diaVencimento: number,
  ajusteFechamento: number
): Promise<void> {
  const candidatas = transacoes.filter(
    t =>
      !t.is_estorno &&
      estaNosUltimosDoisDiasDoCiclo(new Date(t.data_compra + 'T12:00:00'), t.projeto_fatura, diaVencimento, ajusteFechamento)
  )
  if (candidatas.length === 0) return

  const faturasCandidatas = [...new Set(candidatas.map(t => t.projeto_fatura))]

  const { data: faturasRegistradas } = await supabase
    .from('faturas')
    .select('mes_referencia, data_fechamento')
    .eq('cartao', cartao)
    .in('mes_referencia', faturasCandidatas)
  const fechamentosRegistrados = new Map<string, string>(
    (faturasRegistradas ?? []).map(
      (f: { mes_referencia: string; data_fechamento: string }): [string, string] => [f.mes_referencia, f.data_fechamento]
    )
  )
  if (fechamentosRegistrados.size === 0) return

  const faturasPrimeiraImportacao = new Set<string>()
  for (const fatura of faturasCandidatas) {
    if (!fechamentosRegistrados.has(fatura)) continue
    const { count } = await supabase
      .from('transacoes_nubank')
      .select('*', { count: 'exact', head: true })
      .eq('projeto_fatura', fatura)
      .eq('cartao', cartao)
    if ((count ?? 0) === 0) faturasPrimeiraImportacao.add(fatura)
  }
  if (faturasPrimeiraImportacao.size === 0) return

  for (const t of candidatas) {
    if (!faturasPrimeiraImportacao.has(t.projeto_fatura)) continue
    const fechamentoReal = fechamentosRegistrados.get(t.projeto_fatura)
    if (fechamentoReal && t.data_compra >= fechamentoReal) {
      t.projeto_fatura = proximaFatura(t.projeto_fatura)
    }
  }
}
