import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

const JOB_STALE_MS = 6 * 60 * 1000

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { data: job } = await supabase
      .from('categorization_jobs')
      .select('id, status, total, categorized, cota_diaria_esgotada, erros, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!job) return NextResponse.json({ status: 'idle' })

    if (job.status === 'running' && Date.now() - new Date(job.started_at).getTime() > JOB_STALE_MS) {
      return NextResponse.json({ status: 'idle' })
    }

    return NextResponse.json(job)
  } catch {
    return NextResponse.json({ status: 'idle' })
  }
}
