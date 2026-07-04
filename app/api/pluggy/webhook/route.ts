import { NextRequest, NextResponse } from 'next/server'
import { requirePluggyWebhookSecret } from '@/lib/serverAuth'
import { criarSupabaseService } from '@/lib/supabaseService'

export async function POST(req: NextRequest) {
  const unauthorized = requirePluggyWebhookSecret(req)
  if (unauthorized) return unauthorized

  const body = await req.json().catch(() => null)
  const itemId: string | undefined = body?.itemId ?? body?.item?.id
  const event: string | undefined = body?.event

  if (itemId) {
    const supabase = criarSupabaseService()
    await supabase
      .from('pluggy_items')
      .update({ webhook_last_event: event ?? null, webhook_last_received_at: new Date().toISOString() })
      .eq('pluggy_item_id', itemId)

    // Dispara a sincronização em segundo plano (best-effort, sem aguardar).
    // A Pluggy exige um ack em até 5s; o cron diário é o backstop caso esta
    // chamada seja interrompida antes de terminar — a sync é idempotente.
    const syncUrl = new URL('/api/pluggy/sync', req.url)
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      fetch(syncUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      }).catch(err => console.error('[pluggy/webhook] Falha ao disparar sync:', err))
    }
  }

  return NextResponse.json({ ok: true })
}
