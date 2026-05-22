import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const supabaseClient = supabase

  const { data: convs, error } = await supabaseClient
    .from('conversations')
    .select('id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!convs || convs.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  const ids = convs.map(c => c.id)

  const { data: previews } = await supabaseClient
    .from('messages')
    .select('conversation_id, content, role, created_at')
    .in('conversation_id', ids)
    .eq('role', 'user')
    .order('created_at', { ascending: true })

  const previewMap: Record<string, string> = {}
  for (const msg of previews ?? []) {
    if (!previewMap[msg.conversation_id]) {
      previewMap[msg.conversation_id] = msg.content.length > 80
        ? msg.content.slice(0, 80) + '…'
        : msg.content
    }
  }

  const { data: counts } = await supabaseClient
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', ids)
    .neq('role', 'system')

  const countMap: Record<string, number> = {}
  for (const row of counts ?? []) {
    countMap[row.conversation_id] = (countMap[row.conversation_id] ?? 0) + 1
  }

  const conversations = convs
    .filter(c => previewMap[c.id])
    .map(c => ({
      id: c.id,
      created_at: c.created_at,
      preview: previewMap[c.id] ?? 'Conversa sem mensagens',
      message_count: countMap[c.id] ?? 0,
    }))

  return NextResponse.json({ conversations })
}

export async function DELETE(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversation_id')

  if (!conversationId) {
    return NextResponse.json({ error: 'conversation_id é obrigatório' }, { status: 400 })
  }

  // Verify ownership before deleting
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single()

  if (!conv) {
    return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  }

  await supabase.from('messages').delete().eq('conversation_id', conversationId)
  const { error } = await supabase.from('conversations').delete().eq('id', conversationId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
