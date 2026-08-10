import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format } from 'date-fns'

/**
 * POST /api/assinaturas/reativar-pausadas
 *
 * Cron diário: reativa assinaturas pausadas (desativação temporária) cuja
 * data de retorno (pausada_ate) já chegou. A tela de Assinaturas também faz
 * essa reativação ao carregar; este cron garante que dashboard e outras
 * telas que leem `ativa` diretamente fiquem corretas mesmo sem abrir a tela.
 * Protegido por CRON_SECRET em Authorization: Bearer <secret>
 * vercel.json: { "path": "/api/assinaturas/reativar-pausadas", "schedule": "0 6 * * *" }
 */
export async function POST(req: NextRequest) {
  const cronUnauthorized = requireCronSecret(req)
  if (cronUnauthorized) return cronUnauthorized

  const supabase = criarSupabaseServer(req)
  const hoje = format(new Date(), 'yyyy-MM-dd')

  const { data: reativadas, error } = await supabase
    .from('assinaturas')
    .update({ ativa: true, pausada_ate: null })
    .eq('ativa', false)
    .not('pausada_ate', 'is', null)
    .lte('pausada_ate', hoje)
    .select('id')

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, reativadas: reativadas?.length ?? 0 })
}
