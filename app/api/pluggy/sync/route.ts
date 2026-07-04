import { NextRequest, NextResponse } from 'next/server'
import { requirePluggySyncAuth } from '@/lib/serverAuth'
import { sincronizarNubankPluggy } from '@/lib/pluggySync'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await requirePluggySyncAuth(req)
  if (auth.unauthorized) return auth.unauthorized

  try {
    const resultado = await sincronizarNubankPluggy(auth.supabase)
    return NextResponse.json(resultado)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[pluggy/sync] Erro:', msg)
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 })
  }
}
