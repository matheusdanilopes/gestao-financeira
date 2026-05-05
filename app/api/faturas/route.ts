import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const

// GET /api/faturas?cartao=nubank
// Returns all registered fatura closing dates, optionally filtered by cartao
export async function GET(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { searchParams } = new URL(req.url)
    const cartao = searchParams.get('cartao')

    let query = supabase
      .from('faturas')
      .select('*')
      .order('mes_referencia', { ascending: false })

    if (cartao) query = query.eq('cartao', cartao)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ faturas: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// POST /api/faturas
// Body: { cartao, mes_referencia, data_fechamento }
// Upserts a fatura record (creates or updates closing date)
export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const body = await req.json()
    const { cartao, mes_referencia, data_fechamento } = body

    if (!cartao || !CARTOES_VALIDOS.includes(cartao)) {
      return NextResponse.json({ error: 'cartao inválido' }, { status: 400 })
    }
    if (!mes_referencia || !/^\d{4}-\d{2}-\d{2}$/.test(mes_referencia)) {
      return NextResponse.json({ error: 'mes_referencia inválido (esperado yyyy-MM-dd)' }, { status: 400 })
    }
    if (!data_fechamento || !/^\d{4}-\d{2}-\d{2}$/.test(data_fechamento)) {
      return NextResponse.json({ error: 'data_fechamento inválida (esperado yyyy-MM-dd)' }, { status: 400 })
    }

    const { error } = await supabase
      .from('faturas')
      .upsert({ cartao, mes_referencia, data_fechamento }, { onConflict: 'cartao,mes_referencia' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// DELETE /api/faturas
// Body: { cartao, mes_referencia }
// Removes a registered fatura record (reverts to calculated date)
export async function DELETE(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const body = await req.json()
    const { cartao, mes_referencia } = body

    if (!cartao || !mes_referencia) {
      return NextResponse.json({ error: 'cartao e mes_referencia são obrigatórios' }, { status: 400 })
    }

    const { error } = await supabase
      .from('faturas')
      .delete()
      .eq('cartao', cartao)
      .eq('mes_referencia', mes_referencia)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
