import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from './supabaseServer'

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
