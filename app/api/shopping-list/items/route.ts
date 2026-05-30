import { NextRequest, NextResponse } from 'next/server'
import { requireShoppingListAuth } from '@/lib/serverAuth'
import {
  notificarListaMercadoServer,
  registrarHistoricoServer,
  type ItemNotificacao,
} from '@/lib/notificacoesServer'

const CATEGORIAS_VALIDAS = [
  'Proteínas', 'Carboidratos', 'Hortifruti', 'Laticínios', 'Temperos',
  'Congelados', 'Bebidas', 'Higiene', 'Limpeza', 'Outros',
]

type RawItem = Record<string, unknown>

function parseItem(raw: RawItem) {
  const nome = (
    typeof raw.name === 'string' ? raw.name : typeof raw.nome === 'string' ? raw.nome : ''
  ).trim()

  const quantidadeRaw = raw.quantity ?? raw.quantidade
  const quantidade = typeof quantidadeRaw === 'number' ? Math.max(1, Math.round(quantidadeRaw)) : 1

  const unit: string =
    typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : 'unidade'

  const categoryRaw = typeof raw.category === 'string' ? raw.category.trim() : 'Outros'
  const category = CATEGORIAS_VALIDAS.includes(categoryRaw) ? categoryRaw : 'Outros'

  const estimated_price: number | null =
    typeof raw.estimated_price === 'number' ? raw.estimated_price : null

  return { nome, quantidade, unit, category, estimated_price }
}

async function processarItem(
  supabase: Awaited<ReturnType<typeof requireShoppingListAuth>>['supabase'],
  raw: RawItem,
  userId: string | null,
  deUsuario: string,
): Promise<{ notifItem: ItemNotificacao; itemId: string; merged: boolean } | null> {
  const { nome, quantidade, unit, category, estimated_price } = parseItem(raw)
  if (!nome) return null

  // Smart merge: case-insensitive lookup
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

    if (updateError) return null

    await registrarHistoricoServer(supabase, {
      item_id: itemExistente.id,
      action: 'updated',
      user_id: userId,
      criado_por: deUsuario,
      item_nome: itemExistente.nome,
      old_values: { quantidade: itemExistente.quantidade },
      new_values: { quantidade: novaQtd, merge_source: 'smart_merge' },
    })

    return { notifItem: { nome, quantidade: novaQtd, unit }, itemId: itemExistente.id, merged: true }
  }

  // Create new item
  const insertPayload = {
    nome,
    quantidade,
    unit,
    category,
    estimated_price,
    comprado: false,
    criado_por: deUsuario,
    user_id: userId,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('lista_mercado_itens')
    .insert([insertPayload])
    .select('id')
    .single()

  if (insertError || !inserted) return null

  await registrarHistoricoServer(supabase, {
    item_id: inserted.id,
    action: 'created',
    user_id: userId,
    criado_por: deUsuario,
    item_nome: nome,
    new_values: insertPayload as Record<string, unknown>,
  })

  return { notifItem: { nome, quantidade, unit }, itemId: inserted.id, merged: false }
}

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireShoppingListAuth(req)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object') throw new Error()
    body = parsed
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const deUsuario = user?.email ?? user?.id ?? 'api'
  const userId = user?.id ?? null

  // Accept either a single item or an array of items
  const rawItems: RawItem[] = Array.isArray(body)
    ? (body as RawItem[])
    : [body as RawItem]

  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'Nenhum item fornecido' }, { status: 400 })
  }

  const results = await Promise.all(
    rawItems.map(raw => processarItem(supabase, raw, userId, deUsuario))
  )

  const successful = results.filter((r): r is NonNullable<typeof r> => r !== null)

  if (successful.length === 0) {
    return NextResponse.json({ error: 'Nenhum item válido processado' }, { status: 400 })
  }

  // Send ONE notification for all items added in this request
  void notificarListaMercadoServer(
    supabase,
    successful.map(r => r.notifItem),
    deUsuario
  )

  if (rawItems.length === 1) {
    const result = successful[0]
    return NextResponse.json({
      success: true,
      item_id: result.itemId,
      merged: result.merged,
    })
  }

  return NextResponse.json({
    success: true,
    items: successful.map(r => ({ item_id: r.itemId, merged: r.merged })),
    count: successful.length,
  })
}
