import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { data: item } = await supabase!
    .from('pluggy_items')
    .select('pluggy_item_id, connector_name, status, needs_user_action, last_sync_at, last_successful_sync_at, last_error_message')
    .eq('cartao', 'nubank')
    .maybeSingle()

  if (!item) {
    return NextResponse.json({ connected: false })
  }

  return NextResponse.json({
    connected: true,
    itemId: item.pluggy_item_id,
    connectorName: item.connector_name,
    status: item.status,
    needsUserAction: item.needs_user_action,
    lastSyncAt: item.last_sync_at,
    lastSuccessfulSyncAt: item.last_successful_sync_at,
    lastErrorMessage: item.last_error_message,
  })
}
