import { SupabaseClient } from '@supabase/supabase-js'
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { valorEfetivoNoMes, HistoricoValorEntry } from '@/lib/assinaturaValor'
import { identificarAssinaturasNaFatura, TOLERANCIA_CAMBIO } from '@/lib/assinaturaMatch'

export interface AssinaturaSincronizada {
  nome: string
  valorAnterior: number
  valorNovo: number
}

/**
 * Sincroniza o valor de assinaturas em moeda estrangeira com o valor real
 * encontrado nas transações importadas, quando dentro da margem de 5% de
 * tolerância (mesma regra usada em statusTransacao/calcDivergente). Não faz
 * conversão de câmbio nenhuma — só usa o valor já confirmado no extrato.
 *
 * A cobrança é escolhida pela identificação compartilhada (lib/assinaturaMatch.ts),
 * então uma compra avulsa no mesmo estabelecimento não reescreve o valor da
 * assinatura: só entra aqui o lançamento aceito como a cobrança recorrente E
 * dentro da tolerância de câmbio.
 */
export async function sincronizarAssinaturasMoedaEstrangeira(
  supabase: SupabaseClient,
  cartao: string,
  projetosFatura: string[]
): Promise<AssinaturaSincronizada[]> {
  if (projetosFatura.length === 0) return []

  const { data: assinaturas } = await supabase
    .from('assinaturas')
    .select('id, nome, valor, moeda, dia_cobranca')
    .eq('cartao', cartao)
    .eq('ativa', true)
    .neq('moeda', 'BRL')

  if (!assinaturas || assinaturas.length === 0) return []

  const ids = assinaturas.map(a => a.id)
  const [{ data: historicoData }, { data: transacoesData }] = await Promise.all([
    supabase
      .from('assinaturas_historico')
      .select('assinatura_id, valor, vigente_desde, criado_em')
      .in('assinatura_id', ids),
    supabase
      .from('transacoes_nubank')
      .select('descricao, valor, projeto_fatura, data_compra, parcela_atual, total_parcelas')
      .eq('cartao', cartao)
      .in('projeto_fatura', projetosFatura)
      .neq('status', 'ESTORNO')
      .neq('status', 'ESTORNADO'),
  ])

  const historico: HistoricoValorEntry[] = historicoData || []
  const transacoes = transacoesData || []
  const resultado: AssinaturaSincronizada[] = []

  for (const projetoFatura of projetosFatura) {
    const mesReferencia = startOfMonth(subMonths(new Date(projetoFatura + 'T12:00:00'), 1))
    const cutoff = format(endOfMonth(mesReferencia), 'yyyy-MM-dd')
    const vigenteDe = format(mesReferencia, 'yyyy-MM-dd')
    const vigenteFim = cutoff
    const txsDaFatura = transacoes.filter(t => t.projeto_fatura === projetoFatura)

    const identificacoes = identificarAssinaturasNaFatura(
      assinaturas.map(a => ({
        id: a.id,
        nome: a.nome,
        moeda: a.moeda,
        diaCobranca: a.dia_cobranca ?? null,
        valorEsperado: valorEfetivoNoMes(a.id, a.valor, cutoff, historico),
      })),
      txsDaFatura.map(t => ({
        descricao: t.descricao,
        valor: t.valor,
        dataCompra: t.data_compra ?? null,
        parcelaAtual: t.parcela_atual ?? null,
        totalParcelas: t.total_parcelas ?? null,
      })),
    )

    for (const assinatura of assinaturas) {
      const cobranca = identificacoes.get(assinatura.id)?.transacao
      if (!cobranca) continue

      const valorEsperado = valorEfetivoNoMes(assinatura.id, assinatura.valor, cutoff, historico)
      // Só a oscilação de câmbio (5%) é sincronizada automaticamente. Uma diferença
      // maior pode ser reajuste de plano ou compra errada — decisão do usuário.
      if (Math.abs(cobranca.valor - valorEsperado) > valorEsperado * TOLERANCIA_CAMBIO) continue

      // Já bate com o valor registrado — nada a sincronizar.
      if (Math.abs(cobranca.valor - valorEsperado) < 0.005) continue

      const valorNovo = cobranca.valor

      const { error: delErr } = await supabase
        .from('assinaturas_historico')
        .delete()
        .eq('assinatura_id', assinatura.id)
        .gte('vigente_desde', vigenteDe)
        .lte('vigente_desde', vigenteFim)
      if (delErr) continue

      const { error: insErr } = await supabase
        .from('assinaturas_historico')
        .insert([{ assinatura_id: assinatura.id, valor: valorNovo, vigente_desde: vigenteDe }])
      if (insErr) continue

      await supabase.from('assinaturas').update({ valor: valorNovo }).eq('id', assinatura.id)

      resultado.push({ nome: assinatura.nome, valorAnterior: valorEsperado, valorNovo })

      // Mantém o histórico local coerente caso a mesma assinatura apareça em outra fatura do lote.
      historico.push({ assinatura_id: assinatura.id, valor: valorNovo, vigente_desde: vigenteDe, criado_em: new Date().toISOString() })
    }
  }

  return resultado
}
