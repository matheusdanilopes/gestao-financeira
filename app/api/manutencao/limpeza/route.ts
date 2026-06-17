import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { subMonths, subYears, format } from 'date-fns'

/**
 * POST /api/manutencao/limpeza
 *
 * Endpoint para cron job de manutenção mensal no primeiro dia do mês às 03:00.
 * Protegido por CRON_SECRET em Authorization: Bearer <secret>
 * vercel.json: { "path": "/api/manutencao/limpeza", "schedule": "0 3 1 * *" }
 */
export async function POST(req: NextRequest) {
  const cronUnauthorized = requireCronSecret(req)
  if (cronUnauthorized) return cronUnauthorized

  const supabase = criarSupabaseServer(req)

  const agora = new Date()
  const seisMesesAtras = format(subMonths(agora, 6), "yyyy-MM-dd'T'HH:mm:ssxxx")
  const umAnoAtras     = format(subYears(agora, 1),  "yyyy-MM-dd'T'HH:mm:ssxxx")

  const [{ count: logsCount }, { count: messagesCount }] = await Promise.all([
    supabase
      .from('activity_logs')
      .delete({ count: 'exact' })
      .lt('created_at', seisMesesAtras),
    supabase
      .from('messages')
      .delete({ count: 'exact' })
      .lt('created_at', umAnoAtras),
  ])

  return NextResponse.json({
    ok: true,
    logs_deletados: logsCount ?? 0,
    messages_deletados: messagesCount ?? 0,
  })
}
