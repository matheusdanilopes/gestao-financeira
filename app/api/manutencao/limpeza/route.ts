import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { subDays, subMonths, subYears, format } from 'date-fns'

/**
 * POST /api/manutencao/limpeza
 *
 * Endpoint para cron job de manutenção diária às 03:00.
 * Protegido por CRON_SECRET em Authorization: Bearer <secret>
 * vercel.json: { "path": "/api/manutencao/limpeza", "schedule": "0 3 * * *" }
 */
export async function POST(req: NextRequest) {
  const cronUnauthorized = requireCronSecret(req)
  if (cronUnauthorized) return cronUnauthorized

  const supabase = criarSupabaseServer(req)

  const agora = new Date()
  const seisMesesAtras = format(subMonths(agora, 6), "yyyy-MM-dd'T'HH:mm:ssxxx")
  const umAnoAtras     = format(subYears(agora, 1),  "yyyy-MM-dd'T'HH:mm:ssxxx")
  const doisDiasAtras  = format(subDays(agora, 2),   "yyyy-MM-dd'T'HH:mm:ssxxx")

  const [{ count: logsCount }, { count: messagesCount }, { count: validacoesCount }] = await Promise.all([
    supabase
      .from('activity_logs')
      .delete({ count: 'exact' })
      .lt('created_at', seisMesesAtras),
    supabase
      .from('messages')
      .delete({ count: 'exact' })
      .lt('created_at', umAnoAtras),
    supabase
      .from('import_validacoes')
      .delete({ count: 'exact' })
      .lt('created_at', doisDiasAtras),
  ])

  return NextResponse.json({
    ok: true,
    logs_deletados: logsCount ?? 0,
    messages_deletados: messagesCount ?? 0,
    validacoes_deletadas: validacoesCount ?? 0,
  })
}
