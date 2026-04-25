import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)

    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, descricao, valor, created_at')
      .eq('acao', 'importar')
      .eq('tabela', 'transacoes_nubank')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ atividades: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
