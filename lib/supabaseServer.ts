import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

export function criarSupabaseServer(_req: NextRequest) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_anon_key!
  )
}
