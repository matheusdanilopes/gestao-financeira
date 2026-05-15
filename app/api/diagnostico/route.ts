import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(não definido)'
  const projectId = url.includes('.supabase.co')
    ? url.replace('https://', '').split('.')[0]
    : url

  const tabelas = ['wishlist_items', 'lista_mercado_itens']
  const resultados: Record<string, { ok: boolean; erro?: string; linhas?: number }> = {}

  for (const tabela of tabelas) {
    const { data, error } = await supabase.from(tabela).select('id').limit(1)
    if (error) {
      resultados[tabela] = { ok: false, erro: error.message }
    } else {
      resultados[tabela] = { ok: true, linhas: data?.length ?? 0 }
    }
  }

  const todasOk = Object.values(resultados).every(r => r.ok)

  return NextResponse.json({
    projeto: projectId,
    tabelas: resultados,
    status: todasOk ? 'OK — tabelas existem' : 'ERRO — tabelas ausentes, execute o SQL no Supabase',
  })
}
