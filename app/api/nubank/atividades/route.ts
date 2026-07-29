import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(req: NextRequest) {
  try {
    const { supabase, unauthorized } = await requireAuth(req)
    if (unauthorized) return unauthorized

    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '20')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 20) : 20

    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, descricao, valor, created_at')
      .eq('acao', 'importar')
      .eq('tabela', 'transacoes_nubank')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ atividades: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
