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
  const conversationId = searchParams.get('conversation_id')

  if (!conversationId) {
    return NextResponse.json({ error: 'conversation_id obrigatório' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ mensagens: data ?? [] })
}
