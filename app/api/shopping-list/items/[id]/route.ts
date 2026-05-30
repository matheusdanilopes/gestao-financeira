import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { registrarHistoricoServer } from '@/lib/notificacoesServer'

const CATEGORIAS_VALIDAS = [
  'Proteínas', 'Carboidratos', 'Hortifruti', 'Laticínios', 'Temperos',
  'Congelados', 'Bebidas', 'Higiene', 'Limpeza', 'Outros',
]

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { data: item } = await supabase
    .from('lista_mercado_itens')
    .select('*')
    .eq('id', id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const nomeRaw = body.name ?? body.nome
  if (typeof nomeRaw === 'string' && nomeRaw.trim()) {
    updates.nome = nomeRaw.trim()
  }

  const quantidadeRaw = body.quantity ?? body.quantidade
  if (typeof quantidadeRaw === 'number') {
    updates.quantidade = Math.max(1, Math.round(quantidadeRaw))
  }

  if (typeof body.unit === 'string' && body.unit.trim()) {
    updates.unit = body.unit.trim()
  }

  const categoryRaw = typeof body.category === 'string' ? body.category.trim() : null
  if (categoryRaw) {
    updates.category = CATEGORIAS_VALIDAS.includes(categoryRaw) ? categoryRaw : 'Outros'
  }

  if (typeof body.estimated_price === 'number') {
    updates.estimated_price = body.estimated_price
  }

  if (typeof body.checked === 'boolean') {
    updates.comprado = body.checked
  } else if (typeof body.comprado === 'boolean') {
    updates.comprado = body.comprado
  }

  const { error } = await supabase
    .from('lista_mercado_itens')
    .update(updates)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Erro ao atualizar item' }, { status: 500 })
  }

  await registrarHistoricoServer(supabase, {
    item_id: id,
    action: 'updated',
    user_id: user.id,
    criado_por: user.email ?? user.id,
    item_nome: item.nome,
    old_values: item as Record<string, unknown>,
    new_values: updates,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { id } = await params

  const { data: item } = await supabase
    .from('lista_mercado_itens')
    .select('id, nome')
    .eq('id', id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  const { error } = await supabase
    .from('lista_mercado_itens')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Erro ao remover item' }, { status: 500 })
  }

  await registrarHistoricoServer(supabase, {
    item_id: id,
    action: 'deleted',
    user_id: user.id,
    criado_por: user.email ?? user.id,
    item_nome: item.nome,
    old_values: item as Record<string, unknown>,
  })

  return NextResponse.json({ success: true })
}
