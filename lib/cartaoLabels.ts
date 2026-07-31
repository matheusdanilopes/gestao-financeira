import type { SupabaseClient } from '@supabase/supabase-js'

export interface CartaoLabels {
  nubank: string
  cartao1: string
  cartao2: string
}

const PADRAO: CartaoLabels = { nubank: 'NuBank', cartao1: 'Cartão 1', cartao2: 'Cartão 2' }

/**
 * Nome real de cada cartão (ex.: "PicPay", "Itaú"), lido da linha de planejamento
 * "[CARTAO1] <nome>" / "[CARTAO2] <nome>" cadastrada no mês. Cai no rótulo genérico
 * quando o cartão ainda não tem nome cadastrado naquele mês.
 */
export async function buscarCartaoLabels(supabase: SupabaseClient, mesReferencia: string): Promise<CartaoLabels> {
  const { data } = await supabase
    .from('planejamento')
    .select('item')
    .eq('mes_referencia', mesReferencia)

  const itens = (data ?? []) as { item: string }[]
  const c1 = itens.find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
  const c2 = itens.find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()

  return {
    nubank: PADRAO.nubank,
    cartao1: c1 || PADRAO.cartao1,
    cartao2: c2 || PADRAO.cartao2,
  }
}
