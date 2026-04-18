import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

export function criarSupabaseServer(_req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
    ''
  return createClient(url, key)
}
