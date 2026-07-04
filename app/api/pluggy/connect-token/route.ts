import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { createConnectToken } from '@/lib/pluggy'

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json().catch(() => ({}))
    const itemId = typeof body?.itemId === 'string' ? body.itemId : undefined
    const connectToken = await createConnectToken(itemId)
    return NextResponse.json({ connectToken })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[pluggy/connect-token] Erro:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
