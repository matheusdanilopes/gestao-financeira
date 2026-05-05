import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('user_id')

  if (!userId) {
    return NextResponse.json({ error: 'user_id obrigatório' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Fetch conversations ordered by most recent
  const { data: convs, error } = await supabase
    .from('conversations')
    .select('id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!convs || convs.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // For each conversation, fetch the first user message as preview
  // and the last message timestamp for ordering
  const ids = convs.map(c => c.id)

  const { data: previews } = await supabase
    .from('messages')
    .select('conversation_id, content, role, created_at')
    .in('conversation_id', ids)
    .eq('role', 'user')
    .order('created_at', { ascending: true })

  const previewMap: Record<string, string> = {}
  for (const msg of previews ?? []) {
    if (!previewMap[msg.conversation_id]) {
      // First user message = conversation title
      previewMap[msg.conversation_id] = msg.content.length > 80
        ? msg.content.slice(0, 80) + '…'
        : msg.content
    }
  }

  // Count messages per conversation
  const { data: counts } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', ids)
    .neq('role', 'system')

  const countMap: Record<string, number> = {}
  for (const row of counts ?? []) {
    countMap[row.conversation_id] = (countMap[row.conversation_id] ?? 0) + 1
  }

  const conversations = convs
    .filter(c => previewMap[c.id]) // skip empty conversations
    .map(c => ({
      id: c.id,
      created_at: c.created_at,
      preview: previewMap[c.id] ?? 'Conversa sem mensagens',
      message_count: countMap[c.id] ?? 0,
    }))

  return NextResponse.json({ conversations })
}
