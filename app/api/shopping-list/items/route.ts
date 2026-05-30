import { NextRequest, NextResponse } from 'next/server'
import { requireShoppingListAuth } from '@/lib/serverAuth'
import {
  notificarListaMercadoServer,
  registrarHistoricoServer,
} from '@/lib/notificacoesServer'

const CATEGORIAS_VALIDAS = [
  'Proteínas', 'Carboidratos', 'Hortifruti', 'Laticínios', 'Temperos',
  'Congelados', 'Bebidas', 'Higiene', 'Limpeza', 'Outros',
]

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireShoppingListAuth(req)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object') throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const nome = (typeof body.name === 'string' ? body.name : typeof body.nome === 'string' ? body.nome : '').trim()
  if (!nome) {
    return NextResponse.json({ error: 'O campo "name" é obrigatório' }, { status: 400 })
  }

  const quantidadeRaw = body.quantity ?? body.quantidade
  const quantidade = typeof quantidadeRaw === 'number' ? Math.max(1, Math.round(quantidadeRaw)) : 1

  const unit: string = typeof body.unit === 'string' && body.unit.trim()
    ? body.unit.trim()
    : 'unidade'

  const categoryRaw = typeof body.category === 'string' ? body.category.trim() : 'Outros'
  const category = CATEGORIAS_VALIDAS.includes(categoryRaw) ? categoryRaw : 'Outros'

  const estimated_price: number | null = typeof body.estimated_price === 'number' ? body.estimated_price : null

  const deUsuario = user?.email ?? user?.id ?? 'api'

  // ── Smart merge: DB-level case-insensitive lookup (uses idx_lista_mercado_nome) ──
  const { data: itemExistente } = await supabase
    .from('lista_mercado_itens')
    .select('*')
    .eq('comprado', false)
    .ilike('nome', nome)
    .maybeSingle()

  if (itemExistente) {
    const novaQtd = itemExistente.quantidade + quantidade
    const updatePayload: Record<string, unknown> = {
      quantidade: novaQtd,
      updated_at: new Date().toISOString(),
    }
    if (unit && unit !== 'unidade') updatePayload.unit = unit
    if (category) updatePayload.category = category
    if (estimated_price !== null) updatePayload.estimated_price = estimated_price

    const { error: updateError } = await supabase
      .from('lista_mercado_itens')
      .update(updatePayload)
      .eq('id', itemExistente.id)

    if (updateError) {
      return NextResponse.json({ error: 'Erro ao atualizar item' }, { status: 500 })
    }

    await registrarHistoricoServer(supabase, {
      item_id: itemExistente.id,
      action: 'updated',
      user_id: user?.id ?? null,
      criado_por: deUsuario,
      item_nome: itemExistente.nome,
      old_values: { quantidade: itemExistente.quantidade },
      new_values: { quantidade: novaQtd, merge_source: 'smart_merge' },
    })

    void notificarListaMercadoServer(
      supabase,
      [{ nome, quantidade: novaQtd, unit }],
      deUsuario
    )

    return NextResponse.json({ success: true, item_id: itemExistente.id, merged: true })
  }

  // ── Create new item ──────────────────────────────────────────────────────────
  const insertPayload = {
    nome,
    quantidade,
    unit,
    category,
    estimated_price,
    comprado: false,
    criado_por: deUsuario,
    user_id: user?.id ?? null,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('lista_mercado_itens')
    .insert([insertPayload])
    .select('id')
    .single()

  if (insertError || !inserted) {
    return NextResponse.json({ error: 'Erro ao criar item' }, { status: 500 })
  }

  await registrarHistoricoServer(supabase, {
    item_id: inserted.id,
    action: 'created',
    user_id: user?.id ?? null,
    criado_por: deUsuario,
    item_nome: nome,
    new_values: insertPayload as Record<string, unknown>,
  })

  void notificarListaMercadoServer(
    supabase,
    [{ nome, quantidade, unit }],
    deUsuario
  )

  return NextResponse.json({ success: true, item_id: inserted.id, merged: false })
}
