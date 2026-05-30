import { NextRequest, NextResponse } from 'next/server'
import { requireShoppingListAuth } from '@/lib/serverAuth'
import { registrarHistoricoServer } from '@/lib/notificacoesServer'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, supabase, unauthorized } = await requireShoppingListAuth(req)
  if (unauthorized) return unauthorized

  const { id } = await params

  const { data: item } = await supabase
    .from('lista_mercado_itens')
    .select('id, nome, comprado')
    .eq('id', id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  // Allow explicit checked value from body, otherwise toggle
  let checked: boolean
  try {
    const body = await req.json().catch(() => null)
    checked = typeof body?.checked === 'boolean' ? body.checked : !item.comprado
  } catch {
    checked = !item.comprado
  }

  const { error } = await supabase
    .from('lista_mercado_itens')
    .update({ comprado: checked, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Erro ao atualizar status' }, { status: 500 })
  }

  await registrarHistoricoServer(supabase, {
    item_id: id,
    action: checked ? 'checked' : 'unchecked',
    user_id: user?.id ?? null,
    criado_por: user?.email ?? user?.id ?? 'api',
    item_nome: item.nome,
    old_values: { comprado: item.comprado },
    new_values: { comprado: checked },
  })

  return NextResponse.json({ success: true, checked })
}
