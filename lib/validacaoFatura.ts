import { SupabaseClient } from '@supabase/supabase-js'
import { labelCartao } from '@/lib/pushImportacao'

export interface StatsFaturaValidacao {
  noCSV: number
  totalNoBanco: number
}

/**
 * Compara, por fatura (mês), a quantidade de transações do arquivo importado
 * com a quantidade atual no banco para o mesmo cartão. Quando diverge, gera
 * uma notificação (tabela `notificacoes`) para alertar o usuário.
 *
 * Deduplicação: não cria uma nova notificação se já existir uma não lida
 * para o mesmo cartao+mês — evita spam a cada reimportação enquanto a
 * divergência não é resolvida/lida (mesmo padrão de `conflitoExistente` em
 * lib/conciliacao.ts).
 */
export async function validarDivergenciaFatura(
  supabase: SupabaseClient,
  faturaStats: Record<string, StatsFaturaValidacao>,
  cartao: string,
  nomeCartao?: string
): Promise<void> {
  const nome = labelCartao(cartao, nomeCartao)

  for (const [mesReferencia, stats] of Object.entries(faturaStats)) {
    if (stats.totalNoBanco === stats.noCSV) continue

    try {
      const { data: existente } = await supabase
        .from('notificacoes')
        .select('id')
        .eq('acao', 'fatura_divergencia')
        .eq('lida', false)
        .contains('metadata', { cartao, mes_referencia: mesReferencia })
        .maybeSingle()

      if (existente) {
        console.log(`[validacaoFatura] divergência já notificada (não lida) cartao=${cartao} mes=${mesReferencia}`)
        continue
      }

      const diferenca = stats.totalNoBanco - stats.noCSV
      const mesLabel = mesReferencia.substring(0, 7)
      const direcao = diferenca > 0 ? 'a mais' : 'a menos'

      await supabase.from('notificacoes').insert({
        de_usuario: 'sistema',
        nome_usuario: 'Sistema',
        acao: 'fatura_divergencia',
        descricao: `Divergência na fatura ${mesLabel} do ${nome}: ${stats.noCSV} no arquivo, ${stats.totalNoBanco} no banco (${Math.abs(diferenca)} ${direcao}).`,
        metadata: {
          cartao,
          mes_referencia: mesReferencia,
          quantidade_arquivo: stats.noCSV,
          quantidade_banco: stats.totalNoBanco,
          diferenca,
        },
      })
    } catch (error) {
      console.error(`[validacaoFatura] erro ao validar cartao=${cartao} mes=${mesReferencia}:`, error)
    }
  }
}
