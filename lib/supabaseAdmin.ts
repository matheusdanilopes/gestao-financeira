import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente com a service role key — ignora RLS. Só para rotas de servidor que
 * não têm sessão de navegador e autenticam o chamador por outro meio (ex.: o
 * webhook do WhatsApp, que valida a assinatura da Meta e o número vinculado).
 * Nunca importe isto em código de cliente.
 */
export function criarSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return null
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
