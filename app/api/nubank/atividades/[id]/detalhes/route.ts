import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, unauthorized } = await requireAuth(req)
    if (unauthorized) return unauthorized
    const { id } = await params

    const doisDiasAtras = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

    const [{ data, error }, comparacao] = await Promise.all([
      supabase
      .from('import_validacoes')
      .select('id, descricao, valor, data_compra, decisao, transacao_id, notificacao_id, registro_conflitante, revertido_em, created_at')
      .eq('log_id', id)
      .gte('created_at', doisDiasAtras)
      .order('created_at', { ascending: true }),
      // Comparação previsão × importado (lib/comparacaoPrevisao.ts). Fica no próprio log,
      // sem a retenção de 2 dias das linhas; sem a coluna (migration não aplicada) vem null.
      supabase
        .from('activity_logs')
        .select('comparacao_previsao')
        .eq('id', id)
        .maybeSingle()
        .then(r => (r.error ? null : r.data?.comparacao_previsao ?? null)),
    ])

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ linhas: data ?? [], comparacaoPrevisao: comparacao })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
