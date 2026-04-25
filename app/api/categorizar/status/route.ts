import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const JOB_STALE_MS = 6 * 60 * 1000

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

export async function GET() {
  try {
    const supabase = getSupabase()
    const { data: job } = await supabase
      .from('categorization_jobs')
      .select('id, status, total, categorized, cota_diaria_esgotada, erros, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!job) return NextResponse.json({ status: 'idle' })

    // Job travado (servidor caiu ou ultrapassou maxDuration)
    if (job.status === 'running' && Date.now() - new Date(job.started_at).getTime() > JOB_STALE_MS) {
      return NextResponse.json({ status: 'idle' })
    }

    return NextResponse.json(job)
  } catch {
    return NextResponse.json({ status: 'idle' })
  }
}
