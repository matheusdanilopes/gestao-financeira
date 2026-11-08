/**
 * POST /api/categorizar — botão "Categorizar com IA".
 *
 * Corpo opcional: { modo?: 'pendentes' | 'tudo' }
 *  - pendentes (padrão): compras sem categoria + "Outros" que não foi escolhido à mão;
 *  - tudo: refaz também o que foi decidido automaticamente.
 *
 * A decisão em si fica em lib/categorizarTransacoes.ts (mesmo caminho da
 * importação). Aqui só o controle do job que a tela acompanha.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { categorizarTransacoes, type ModoCategorizacao } from '@/lib/categorizarTransacoes'

export const maxDuration = 300

const JOB_STALE_MS = 6 * 60 * 1000
/** Folga para gravar o resultado do job antes do limite da função. */
const PRAZO_MS = 270_000

const isStaleJob = (startedAt: string) => Date.now() - new Date(startedAt).getTime() > JOB_STALE_MS

export async function POST(req: NextRequest) {
  const inicio = Date.now()
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  let modo: ModoCategorizacao = 'pendentes'
  try {
    const body = await req.json()
    if (body?.modo === 'tudo') modo = 'tudo'
  } catch { /* sem corpo: modo padrão */ }

  // Evita iniciar dois jobs simultâneos
  const { data: runningJob } = await supabase
    .from('categorization_jobs')
    .select('id, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (runningJob && !isStaleJob(runningJob.started_at)) {
    return NextResponse.json({ running: true, message: 'Categorização já em andamento' })
  }

  const { data: job } = await supabase
    .from('categorization_jobs')
    .insert({ status: 'running' })
    .select('id')
    .single()
  const jobId: string | undefined = job?.id

  // Progresso para a tela, sem gravar a cada compra.
  let ultimoProgresso = 0
  const aoProgresso = (feitas: number, total: number) => {
    if (!jobId || Date.now() - ultimoProgresso < 3_000) return
    ultimoProgresso = Date.now()
    void supabase.from('categorization_jobs').update({ total, categorized: feitas }).eq('id', jobId).then(() => {})
  }

  try {
    const resultado = await categorizarTransacoes(supabase, apiKey, { modo, deadlineMs: inicio + PRAZO_MS, aoProgresso })

    if (jobId) {
      await supabase.from('categorization_jobs').update({
        status: 'done',
        total: resultado.total,
        categorized: resultado.categorized,
        cota_diaria_esgotada: resultado.cotaDiariaEsgotada,
        erros: resultado.erros ?? null,
        finished_at: new Date().toISOString(),
      }).eq('id', jobId)
    }

    return NextResponse.json({
      ...resultado,
      message: resultado.total === 0 ? 'Nenhuma compra para categorizar' : undefined,
    })
  } catch (error) {
    console.error('[categorizar]', error)
    if (jobId) {
      await supabase.from('categorization_jobs')
        .update({ status: 'error', erros: [String(error)], finished_at: new Date().toISOString() })
        .eq('id', jobId)
    }
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
