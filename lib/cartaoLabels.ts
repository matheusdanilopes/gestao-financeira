import type { SupabaseClient } from '@supabase/supabase-js'
import { PREFIXO_PRINCIPAL, PREFIXO_CARTAO_1, PREFIXO_CARTAO_2 } from '@/lib/tipoCartao'

export interface CartaoLabels {
  nubank: string
  principal: string
  cartao1: string
  cartao2: string
}

export const CARTAO_LABELS_PADRAO: CartaoLabels = {
  nubank: 'NuBank',
  principal: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

function nomeDoPrefixo(itens: { item: string }[], prefixo: string): string | undefined {
  const linha = itens.find(p => typeof p.item === 'string' && p.item.startsWith(prefixo))
  return linha?.item?.replace(prefixo, '').trim() || undefined
}

/**
 * Nome real de cada cartão (ex.: "PicPay", "Itaú"), lido da linha de planejamento
 * "[CARTAO1] <nome>" / "[CARTAO2] <nome>" cadastrada no mês. Cai no rótulo genérico
 * quando o cartão ainda não tem nome cadastrado naquele mês.
 *
 * O principal é um caso à parte: cada cartão adicional é uma linha [PRINCIPAL], então
 * a primeira delas nomearia o cartão com o nome de um adicional ("Matheus"). Por isso
 * ele fica sempre no rótulo padrão "NuBank" — é a fatura inteira, não um adicional.
 */
export async function buscarCartaoLabels(supabase: SupabaseClient, mesReferencia: string): Promise<CartaoLabels> {
  const { data } = await supabase
    .from('planejamento')
    .select('item')
    .eq('mes_referencia', mesReferencia)

  const itens = (data ?? []) as { item: string }[]

  return {
    nubank: CARTAO_LABELS_PADRAO.nubank,
    principal: CARTAO_LABELS_PADRAO.principal,
    cartao1: nomeDoPrefixo(itens, PREFIXO_CARTAO_1) || CARTAO_LABELS_PADRAO.cartao1,
    cartao2: nomeDoPrefixo(itens, PREFIXO_CARTAO_2) || CARTAO_LABELS_PADRAO.cartao2,
  }
}

/** Versão em memória, para quem já carregou o planejamento do mês. */
export function cartaoLabelsDePlanejamento(itens: { item: string }[]): CartaoLabels {
  return {
    nubank: CARTAO_LABELS_PADRAO.nubank,
    principal: CARTAO_LABELS_PADRAO.principal,
    cartao1: nomeDoPrefixo(itens, PREFIXO_CARTAO_1) || CARTAO_LABELS_PADRAO.cartao1,
    cartao2: nomeDoPrefixo(itens, PREFIXO_CARTAO_2) || CARTAO_LABELS_PADRAO.cartao2,
  }
}

export { PREFIXO_PRINCIPAL }
