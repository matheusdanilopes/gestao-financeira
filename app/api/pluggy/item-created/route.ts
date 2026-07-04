import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { getItem } from '@/lib/pluggy'

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const body = await req.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' ? body.itemId : undefined
  if (!itemId) {
    return NextResponse.json({ error: 'Campo "itemId" ausente no body.' }, { status: 400 })
  }

  try {
    const item = await getItem(itemId)
    const isErro = item.status !== 'UPDATED'

    const { error } = await supabase!
      .from('pluggy_items')
      .upsert(
        {
          pluggy_item_id: item.id,
          connector_id: item.connector?.id ?? null,
          connector_name: item.connector?.name ?? null,
          cartao: 'nubank',
          status: item.status,
          execution_status: item.executionStatus,
          raw_item: item,
          last_sync_at: new Date().toISOString(),
          consecutive_errors: 0,
          needs_user_action: isErro,
          last_error_code: item.error?.code ?? null,
          last_error_message: item.error?.message ?? null,
        },
        { onConflict: 'pluggy_item_id' }
      )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, item })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[pluggy/item-created] Erro:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
