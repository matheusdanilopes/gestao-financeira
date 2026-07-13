import { SupabaseClient } from '@supabase/supabase-js'
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { valorEfetivoNoMes, HistoricoValorEntry } from '@/lib/assinaturaValor'

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
 */
export async function sincronizarAssinaturasMoedaEstrangeira(
  supabase: SupabaseClient,
  cartao: string,
  projetosFatura: string[]
): Promise<AssinaturaSincronizada[]> {
  if (projetosFatura.length === 0) return []

  const { data: assinaturas } = await supabase
    .from('assinaturas')
    .select('id, nome, valor, moeda')
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
      .select('descricao, valor, projeto_fatura')
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

    for (const assinatura of assinaturas) {
      const nome = assinatura.nome.toLowerCase()
      const matches = txsDaFatura.filter(t => t.descricao?.toLowerCase().includes(nome))
      if (matches.length === 0) continue

      const valorEsperado = valorEfetivoNoMes(assinatura.id, assinatura.valor, cutoff, historico)
      const tolerancia = valorEsperado * 0.05
      const dentro = matches.filter(t => Math.abs(t.valor - valorEsperado) <= tolerancia)
      if (dentro.length === 0) continue

      const melhor = dentro.reduce((best, cur) =>
        Math.abs(cur.valor - valorEsperado) < Math.abs(best.valor - valorEsperado) ? cur : best
      )

      // Já bate com o valor registrado — nada a sincronizar.
      if (Math.abs(melhor.valor - valorEsperado) < 0.005) continue

      const valorNovo = melhor.valor

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
