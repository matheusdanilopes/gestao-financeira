import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * Cliente Supabase com a service role key, sem cookies de sessão.
 * Necessário para as rotas de cron/webhook da Pluggy: essas requisições não
 * carregam sessão de usuário, e as tabelas usadas (`transacoes_nubank`,
 * `configuracoes`, `activity_logs`, `notificacoes`, `pluggy_items`) têm RLS
 * `auth.role() = 'authenticated'`, que o cliente anon (`criarSupabaseServer`)
 * nunca satisfaz sem cookies — a service role ignora RLS.
 *
 * Nunca importar este módulo em código que roda no browser.
 */
export function criarSupabaseService() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
