import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

interface ResolverBody {
  notificacao_id: string
  acao: 'aprovar' | 'recusar'
}

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: ResolverBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  const { notificacao_id, acao } = body
  if (!notificacao_id || !['aprovar', 'recusar'].includes(acao)) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: notificacao_id e acao ("aprovar" | "recusar").' },
      { status: 400 }
    )
  }

  // Carrega a notificação para obter o metadata do conflito
  const { data: notif, error: notifErr } = await supabase
    .from('notificacoes')
    .select('id, acao, metadata, lida')
    .eq('id', notificacao_id)
    .single()

  if (notifErr || !notif) {
    return NextResponse.json({ error: 'Notificação não encontrada.' }, { status: 404 })
  }
  if (notif.acao !== 'conciliacao_conflito') {
    return NextResponse.json({ error: 'Notificação não é um conflito de conciliação.' }, { status: 422 })
  }
  if (notif.lida) {
    return NextResponse.json({ error: 'Conflito já foi resolvido.' }, { status: 409 })
  }

  const { original_id, conflito_id, valor_novo } = notif.metadata as {
    original_id: string
    conflito_id: string
    valor_novo: number
    valor_original: number
    descricao: string
    data_compra: string
  }

  if (!original_id || !conflito_id) {
    return NextResponse.json({ error: 'Metadata inválida.' }, { status: 422 })
  }

  if (acao === 'aprovar') {
    // Substitui o valor do registro original pelo valor do CSV/API
    const { error: updErr } = await supabase
      .from('transacoes_nubank')
      .update({ valor_final: valor_novo, status: 'CONCILIADO' })
      .eq('id', original_id)

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao atualizar registro original: ' + updErr.message }, { status: 500 })
    }

    // Remove o registro de conflito (o valor foi incorporado ao original)
    await supabase.from('transacoes_nubank').delete().eq('id', conflito_id)
  } else {
    // Recusa: converte o conflito em uma compra nova (PENDENTE)
    const { error: updErr } = await supabase
      .from('transacoes_nubank')
      .update({ status: 'PENDENTE', conciliacao_ref: null })
      .eq('id', conflito_id)

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao converter conflito em compra: ' + updErr.message }, { status: 500 })
    }
  }

  // Marca a notificação como lida (resolvida)
  await supabase.from('notificacoes').update({ lida: true }).eq('id', notificacao_id)

  return NextResponse.json({ success: true, acao })
}
