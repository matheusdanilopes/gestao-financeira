/**
 * POST /api/chat/avaliacao — 👍/👎 numa resposta do Fin.
 *
 * Corpo: { message_id, avaliacao: 1 | -1 | null, comentario? }
 * null desfaz a avaliação. Só vale para respostas do assistente em conversas
 * do próprio usuário.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

const LIMITE_COMENTARIO = 1_000

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: { message_id?: unknown; avaliacao?: unknown; comentario?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const messageId = typeof body.message_id === 'string' ? body.message_id : null
  const avaliacao = body.avaliacao === 1 || body.avaliacao === -1 ? body.avaliacao : body.avaliacao === null ? null : undefined
  if (!messageId || avaliacao === undefined) {
    return NextResponse.json({ error: 'message_id e avaliacao (1, -1 ou null) são obrigatórios' }, { status: 400 })
  }
  const comentario = typeof body.comentario === 'string' && body.comentario.trim()
    ? body.comentario.trim().slice(0, LIMITE_COMENTARIO)
    : null

  const { data: msg } = await supabase
    .from('messages')
    .select('id, role, conversation_id')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg || msg.role !== 'assistant') {
    return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', msg.conversation_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!conv) {
    return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
  }

  const { error } = await supabase
    .from('messages')
    .update({
      avaliacao,
      avaliacao_comentario: avaliacao === null ? null : comentario,
      avaliado_em: avaliacao === null ? null : new Date().toISOString(),
    })
    .eq('id', messageId)

  if (error) {
    // Coluna ainda não criada: a migration migration_messages_meta_avaliacao.sql não foi aplicada.
    const semColuna = error.code === 'PGRST204' || error.code === '42703'
    return NextResponse.json(
      { error: semColuna ? 'Avaliação indisponível: falta aplicar a migration de avaliação.' : error.message },
      { status: semColuna ? 501 : 500 }
    )
  }
  return NextResponse.json({ ok: true })
}
