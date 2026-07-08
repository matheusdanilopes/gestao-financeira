import { SupabaseClient } from '@supabase/supabase-js'
import { labelCartao } from '@/lib/pushImportacao'
import { TransacaoNubank } from '@/lib/csvparser'
import { formatBRL } from '@/lib/logger'

export interface StatsFaturaValidacao {
  noCSV: number
  totalNoBanco: number
}

interface LinhaBanco {
  id: string
  hash_linha: string
  descricao: string
  valor: number
  data_compra: string
}

/**
 * Compara, por fatura (mês), a quantidade de transações do arquivo importado
 * com a quantidade atual no banco para o mesmo cartão. Quando o banco tem
 * MAIS transações que o arquivo, identifica a(s) linha(s) excedente(s)
 * (presentes no banco, ausentes do arquivo, via `hash_linha`) e gera uma
 * notificação (tabela `notificacoes`) apontando exatamente para ela(s).
 *
 * Deduplicação: não cria uma nova notificação se já existir uma não lida
 * para o mesmo cartao+mês — evita spam a cada reimportação enquanto a
 * divergência não é resolvida/lida (mesmo padrão de `conflitoExistente` em
 * lib/conciliacao.ts).
 */
export async function validarDivergenciaFatura(
  supabase: SupabaseClient,
  faturaStats: Record<string, StatsFaturaValidacao>,
  transacoesArquivo: TransacaoNubank[],
  cartao: string,
  nomeCartao?: string
): Promise<void> {
  const nome = labelCartao(cartao, nomeCartao)

  for (const [mesReferencia, stats] of Object.entries(faturaStats)) {
    if (stats.totalNoBanco <= stats.noCSV) continue

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

      const { data: linhasBanco, error: linhasBancoError } = await supabase
        .from('transacoes_nubank')
        .select('id, hash_linha, descricao, valor, data_compra')
        .eq('projeto_fatura', mesReferencia)
        .eq('cartao', cartao)
        .eq('is_estorno', false)

      let linhas: LinhaBanco[] = linhasBanco ?? []

      // Fallback para schema legado (coluna 'data' em vez de 'data_compra'),
      // mesmo padrão usado em lib/conciliacao.ts e app/api/import/cartao/route.ts.
      if (linhasBancoError?.message?.includes('data_compra')) {
        const { data: linhasBancoLegado, error: erroLegado } = await supabase
          .from('transacoes_nubank')
          .select('id, hash_linha, descricao, valor, data')
          .eq('projeto_fatura', mesReferencia)
          .eq('cartao', cartao)
          .eq('is_estorno', false)
        if (erroLegado) {
          console.error(`[validacaoFatura] erro ao buscar linhas do banco (legado) cartao=${cartao} mes=${mesReferencia}:`, erroLegado)
        }
        linhas = (linhasBancoLegado ?? []).map((r: Record<string, unknown>) => ({ ...r, data_compra: r.data }) as LinhaBanco)
      } else if (linhasBancoError) {
        console.error(`[validacaoFatura] erro ao buscar linhas do banco cartao=${cartao} mes=${mesReferencia}:`, linhasBancoError)
      }

      const hashesArquivo = new Set(
        transacoesArquivo
          .filter(t => t.projeto_fatura === mesReferencia)
          .map(t => t.hash_linha)
      )

      const excedentes: LinhaBanco[] = linhas.filter(
        (r: LinhaBanco) => !hashesArquivo.has(r.hash_linha)
      )

      let descricao: string
      if (excedentes.length === 1) {
        const [linha] = excedentes
        const data = linha.data_compra?.substring(8, 10)
        const mes = linha.data_compra?.substring(5, 7)
        descricao = `Fatura ${mesLabel} do ${nome}: "${linha.descricao}" (${formatBRL(linha.valor)}${data && mes ? ` em ${data}/${mes}` : ''}) está no banco mas não consta no arquivo importado.`
      } else if (excedentes.length > 1) {
        descricao = `Fatura ${mesLabel} do ${nome}: ${excedentes.length} transações estão no banco mas não constam no arquivo importado.`
      } else {
        descricao = `Divergência na fatura ${mesLabel} do ${nome}: ${stats.noCSV} no arquivo, ${stats.totalNoBanco} no banco (${diferenca} a mais).`
      }

      await supabase.from('notificacoes').insert({
        de_usuario: 'sistema',
        nome_usuario: 'Sistema',
        acao: 'fatura_divergencia',
        descricao,
        metadata: {
          cartao,
          mes_referencia: mesReferencia,
          quantidade_arquivo: stats.noCSV,
          quantidade_banco: stats.totalNoBanco,
          diferenca,
          ...(excedentes.length > 0 ? { transacao_ids: excedentes.map(e => e.id) } : {}),
        },
      })
    } catch (error) {
      console.error(`[validacaoFatura] erro ao validar cartao=${cartao} mes=${mesReferencia}:`, error)
    }
  }
}
