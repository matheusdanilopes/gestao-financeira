import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { item_id } = await req.json()
  if (!item_id) return NextResponse.json({ error: 'item_id é obrigatório' }, { status: 400 })

  const { data: item, error: fetchError } = await supabase
    .from('listas_compras_itens')
    .select('id, nome, preco_previsto')
    .eq('id', item_id)
    .single()

  if (fetchError || !item) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  const { data: wItem, error: wErr } = await supabase
    .from('wishlist_items')
    .insert([{
      nome:           item.nome,
      valor_estimado: item.preco_previsto ?? null,
      criado_por:     user?.email ?? null,
      realizado:      false,
      prioridade:     'media',
      ai_status:      'manual',
      fonte:          'manual',
    }])
    .select('id')
    .single()

  if (wErr) {
    return NextResponse.json({ error: 'Erro ao criar item na Wishlist' }, { status: 500 })
  }

  await supabase.from('listas_compras_itens').delete().eq('id', item_id)

  return NextResponse.json({ success: true, wishlist_id: wItem.id })
}
