/**
 * Compatibilidade para quem só precisa do núcleo de dados em bloco (ex.: a rota
 * de insights). A leitura, o cache e a janela de histórico moram em
 * lib/ai/data — ver GatewayDados. O assessor (chat e Telegram) usa o gateway
 * direto, que além disso estende o histórico e lê fontes extras sob demanda.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { EnrichedData } from './types'
import { obterNucleo, invalidarCacheDados } from './data/gateway'

export { DadosIndisponiveisError } from './data/nucleo'

// Só para chamadores sem sessão. O caminho normal é receber o cliente
// autenticado da rota: com a anon key "crua", nenhuma tabela protegida por RLS
// (ex.: limites_parcelamentos) é legível.
function getSupabaseAnon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      'placeholder'
  )
}

/** O cache é do casal, não da pessoa: limpar para um usuário limpa para todos. */
export function clearEnrichedDataCache(_userId?: string): void {
  invalidarCacheDados()
}

/**
 * Núcleo bruto (antes da auditoria) com a janela quente de histórico.
 * Não altere o objeto devolvido: ele é o mesmo que fica em cache.
 */
export async function fetchEnrichedData(
  userId: string,
  force = false,
  cliente?: SupabaseClient
): Promise<EnrichedData> {
  const entrada = await obterNucleo(cliente ?? getSupabaseAnon(), userId, force)
  return entrada.bruto
}
