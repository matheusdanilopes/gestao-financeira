import { SupabaseClient } from '@supabase/supabase-js'
import { format } from 'date-fns'
import { TransacaoNubank } from '@/lib/csvparser'
import { proximaFatura } from '@/lib/fatura'

function faturaAnterior(mesReferenciaISO: string): string {
  const [ano, mes] = mesReferenciaISO.split('-').map(Number)
  return format(new Date(ano, mes - 2, 1), 'yyyy-MM-dd')
}

/**
 * Corrige a fatura das compras NOVAS (ainda não gravadas) usando o fechamento real
 * cadastrado manualmente (Configurações → Faturas), quando ele difere do
 * fechamento estimado pela fórmula:
 *
 * - fechamento real da fatura F cadastrado e a compra é de F mas foi feita no dia
 *   do fechamento real ou depois → vai para a fatura seguinte;
 * - fechamento real da fatura anterior a F cadastrado e a compra foi feita antes
 *   dele → volta para a fatura anterior (fechamento real depois do estimado).
 *
 * Só vale para compras que ainda não existem no banco (pelo hash): as já gravadas
 * mantêm a fatura em que estão — reimportar o mesmo extrato não desfaz ajustes
 * manuais. Antes valia só na "primeira importação" da fatura, o que nunca
 * acontecia com importações incrementais (a fatura já tinha lançamentos).
 *
 * É o caminho de reserva: quando o arquivo diz a fatura (ver lib/faturaArquivo.ts),
 * ela é usada no lugar desta estimativa por data.
 *
 * Muda apenas `projeto_fatura` nos objetos passados (in-place). Precisa ser
 * chamada ANTES do lote ser gravado.
 */
export async function corrigirFaturaPeloFechamentoReal(
  supabase: SupabaseClient,
  transacoes: TransacaoNubank[],
  cartao: string
): Promise<void> {
  const compras = transacoes.filter(t => !t.is_estorno)
  if (compras.length === 0) return

  const faturas = new Set<string>()
  for (const t of compras) {
    faturas.add(t.projeto_fatura)
    faturas.add(faturaAnterior(t.projeto_fatura))
  }

  const { data: faturasRegistradas } = await supabase
    .from('faturas')
    .select('mes_referencia, data_fechamento')
    .eq('cartao', cartao)
    .in('mes_referencia', [...faturas])
  const fechamentoReal = new Map<string, string>(
    (faturasRegistradas ?? []).map(
      (f: { mes_referencia: string; data_fechamento: string }): [string, string] => [f.mes_referencia, f.data_fechamento]
    )
  )
  if (fechamentoReal.size === 0) return

  const candidatas = compras.filter(t =>
    fechamentoReal.has(t.projeto_fatura) || fechamentoReal.has(faturaAnterior(t.projeto_fatura))
  )
  if (candidatas.length === 0) return

  // Em lotes: muitos hashes num só `.in()` estouram o tamanho da URL (ver lib/conciliacao.ts).
  const hashes = [...new Set(candidatas.map(t => t.hash_linha))]
  const jaGravadas = new Set<string>()
  for (let i = 0; i < hashes.length; i += 100) {
    const { data: existentes, error } = await supabase
      .from('transacoes_nubank')
      .select('hash_linha')
      .in('hash_linha', hashes.slice(i, i + 100))
    // Sem saber o que já está gravado, não mexe em nada.
    if (error) return
    for (const r of (existentes ?? []) as Array<{ hash_linha: string }>) jaGravadas.add(r.hash_linha)
  }

  for (const t of candidatas) {
    if (jaGravadas.has(t.hash_linha)) continue
    const fatura = t.projeto_fatura
    const fechamentoDaFatura = fechamentoReal.get(fatura)
    const fechamentoDaAnterior = fechamentoReal.get(faturaAnterior(fatura))

    if (fechamentoDaFatura && t.data_compra >= fechamentoDaFatura) {
      t.projeto_fatura = proximaFatura(fatura)
    } else if (fechamentoDaAnterior && t.data_compra < fechamentoDaAnterior) {
      t.projeto_fatura = faturaAnterior(fatura)
    }
  }
}
