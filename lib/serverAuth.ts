import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from './supabaseServer'
import { criarSupabaseService } from './supabaseService'

export type AuthedResult =
  | { user: { id: string; email?: string }; supabase: ReturnType<typeof criarSupabaseServer>; unauthorized: null }
  | { user: null; supabase: null; unauthorized: NextResponse }

export async function requireAuth(req: NextRequest): Promise<AuthedResult> {
  const supabase = criarSupabaseServer(req)
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      user: null,
      supabase: null,
      unauthorized: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }),
    }
  }

  return { user: { id: user.id, email: user.email }, supabase, unauthorized: null }
}

/** For cron endpoints: validates a shared secret instead of user session */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return null // secret not configured → allow (backwards compat)
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return null
  return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
}

export type ShoppingListAuthResult =
  | { user: { id: string; email?: string } | null; supabase: ReturnType<typeof criarSupabaseServer>; unauthorized: null }
  | { user: null; supabase: null; unauthorized: NextResponse }

/**
 * Auth para a Shopping List API.
 * Se SHOPPING_LIST_API_KEY estiver configurada: aceita apenas Authorization: Bearer <key>.
 * Caso contrário: fallback para sessão Supabase (mesmo padrão do nubank/importar).
 */
export async function requireShoppingListAuth(req: NextRequest): Promise<ShoppingListAuthResult> {
  const apiKey = process.env.SHOPPING_LIST_API_KEY

  if (apiKey) {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return {
        user: null,
        supabase: null,
        unauthorized: NextResponse.json(
          { error: 'Não autenticado', hint: 'Use Authorization: Bearer <SHOPPING_LIST_API_KEY>' },
          { status: 401 }
        ),
      }
    }
    if (authHeader.slice(7) !== apiKey) {
      return {
        user: null,
        supabase: null,
        unauthorized: NextResponse.json({ error: 'API key inválida' }, { status: 401 }),
      }
    }
    return { user: null, supabase: criarSupabaseServer(req), unauthorized: null }
  }

  // API key não configurada → fallback para sessão Supabase
  return requireAuth(req)
}

/**
 * Para o webhook da Pluggy: valida um segredo compartilhado. O dashboard da
 * Pluggy (tela "Webhooks") só expõe URL + tipo de evento, sem campo de
 * headers customizados — headers só são configuráveis chamando `POST
 * /webhooks` diretamente na API. Por isso o segredo é aceito tanto via
 * query string (`?secret=...` na URL cadastrada no dashboard) quanto via
 * header `x-webhook-secret` (para quem cadastrar o webhook pela API com
 * `headers`). Diferente de `requireCronSecret`, aqui a ausência da env var
 * **rejeita** a requisição: não existe chamador legado dependendo dessa
 * rota estar aberta.
 */
export function requirePluggyWebhookSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'PLUGGY_WEBHOOK_SECRET não configurado no servidor' }, { status: 401 })
  }
  const header = req.headers.get('x-webhook-secret') ?? ''
  const fromQuery = new URL(req.url).searchParams.get('secret') ?? ''
  if (header === secret || fromQuery === secret) return null
  return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
}

export type PluggySyncAuthResult =
  | { supabase: ReturnType<typeof criarSupabaseService>; via: 'cron'; unauthorized: null }
  | { supabase: ReturnType<typeof criarSupabaseServer>; via: 'session'; unauthorized: null }
  | { supabase: null; via: null; unauthorized: NextResponse }

/**
 * Autenticação da rota /api/pluggy/sync: aceita o CRON_SECRET (cron do Vercel
 * ou o fire-and-forget disparado pelo webhook) OU sessão de usuário (botão
 * "Sincronizar agora" manual). O caminho via CRON_SECRET usa o cliente com
 * service role, pois essas requisições não têm cookies de sessão e as
 * tabelas envolvidas têm RLS `auth.role() = 'authenticated'`.
 */
export async function requirePluggySyncAuth(req: NextRequest): Promise<PluggySyncAuthResult> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader === `Bearer ${secret}`) {
      return { supabase: criarSupabaseService(), via: 'cron', unauthorized: null }
    }
  }

  const authed = await requireAuth(req)
  if (authed.unauthorized) {
    return { supabase: null, via: null, unauthorized: authed.unauthorized }
  }
  return { supabase: authed.supabase, via: 'session', unauthorized: null }
}
