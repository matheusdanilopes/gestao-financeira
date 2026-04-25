import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'

export const maxDuration = 300

const LOTE = 20
const DELAY_ENTRE_LOTES_MS = 5000
const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const CONFIANCA_PADRAO_IA = 0.85
const JOB_STALE_MS = 6 * 60 * 1000

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isStaleJob(startedAt: string): boolean {
  return Date.now() - new Date(startedAt).getTime() > JOB_STALE_MS
}

function extrairRetryDelay(errText: string): number {
  const match = errText.match(/"retryDelay":\s*"(\d+)s"/)
  return match ? (parseInt(match[1]) + 2) * 1000 : 60000
}

function isCotaDiaria(errText: string): boolean {
  return errText.includes('GenerateRequestsPerDayPerProjectPerModel')
}

async function categorizarLote(
  transacoes: { hash_linha: string; descricao: string }[],
  apiKey: string,
  categoriasPermitidas: string[]
): Promise<string[]> {
  const lista = transacoes.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n')

  const prompt = `Categorize cada transação abaixo com UMA das categorias: ${categoriasPermitidas.join(', ')}.

Transações:
${lista}

Retorne um JSON no formato: {"categorias": ["Categoria1", "Categoria2", ...]}
A lista deve ter exatamente ${transacoes.length} itens, na mesma ordem das transações.`

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini erro ${res.status}: ${body}`)
  }

  const data = await res.json()
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!texto) throw new Error('Resposta vazia da IA')

  const { categorias } = JSON.parse(texto)
  if (!Array.isArray(categorias) || categorias.length !== transacoes.length) {
    throw new Error(`Número de categorias retornado (${categorias?.length}) diferente do esperado (${transacoes.length})`)
  }

  const fallback = categoriasPermitidas.includes('Outros') ? 'Outros' : categoriasPermitidas[0]
  return categorias.map((c: string) => (categoriasPermitidas.includes(c) ? c : fallback))
}

async function categorizarLoteComRetry(
  transacoes: { hash_linha: string; descricao: string }[],
  apiKey: string,
  categoriasPermitidas: string[],
  maxRetries = 2
): Promise<string[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await categorizarLote(transacoes, apiKey, categoriasPermitidas)
    } catch (err) {
      const errStr = String(err)
      const is429 = errStr.includes('429')

      if (!is429 || attempt === maxRetries) throw err
      if (isCotaDiaria(errStr)) throw new Error('COTA_DIARIA_ESGOTADA')

      const waitMs = extrairRetryDelay(errStr)
      console.warn(`[categorizar] 429 recebido, aguardando ${waitMs}ms antes de retry ${attempt + 1}/${maxRetries}`)
      await sleep(waitMs)
    }
  }
  throw new Error('Max retries exceeded')
}

export async function POST(_req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  const supabase = getSupabase()

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

  // Cria o job imediatamente para que o cliente possa rastreá-lo
  const { data: job } = await supabase
    .from('categorization_jobs')
    .insert({ status: 'running' })
    .select('id')
    .single()
  const jobId: string | undefined = job?.id

  try {
    const { data: configuracoes } = await supabase
      .from('configuracoes')
      .select('chave, valor')
      .eq('chave', 'categorias_compras')
      .maybeSingle()
    const categoriasPermitidas = parseCategoriasConfig(configuracoes?.valor) || CATEGORIAS_PADRAO

    const { data: transacoes, error } = await supabase
      .from('transacoes_nubank')
      .select('hash_linha, descricao, categoria, categoria_origem')
      .or('categoria.is.null,categoria_origem.eq.IA')
      .order('data', { ascending: false })

    if (error) {
      if (jobId) await supabase.from('categorization_jobs').update({ status: 'error', finished_at: new Date().toISOString() }).eq('id', jobId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!transacoes || transacoes.length === 0) {
      if (jobId) {
        await supabase.from('categorization_jobs')
          .update({ status: 'done', total: 0, categorized: 0, finished_at: new Date().toISOString() })
          .eq('id', jobId)
      }
      return NextResponse.json({ categorized: 0, total: 0, message: 'Nenhuma transação sem categoria' })
    }

    // Atualiza o total para que o cliente veja o progresso esperado
    if (jobId) {
      await supabase.from('categorization_jobs').update({ total: transacoes.length }).eq('id', jobId)
    }

    let totalCategorized = 0
    const erros: string[] = []
    let cotaDiariaEsgotada = false

    for (let i = 0; i < transacoes.length; i += LOTE) {
      if (cotaDiariaEsgotada) break

      const lote = transacoes.slice(i, i + LOTE)
      const numLote = Math.floor(i / LOTE) + 1

      try {
        const categorias = await categorizarLoteComRetry(lote, apiKey, categoriasPermitidas)

        await Promise.all(
          lote.map((t, j) =>
            supabase
              .from('transacoes_nubank')
              .update({
                categoria: categorias[j],
                categoria_origem: 'IA',
                categoria_confianca: CONFIANCA_PADRAO_IA,
              })
              .eq('hash_linha', t.hash_linha)
          )
        )

        totalCategorized += lote.length

        if (i + LOTE < transacoes.length) {
          await sleep(DELAY_ENTRE_LOTES_MS)
        }
      } catch (err) {
        const errStr = String(err)
        if (errStr.includes('COTA_DIARIA_ESGOTADA')) {
          cotaDiariaEsgotada = true
          erros.push(`Cota diária do Gemini esgotada após ${totalCategorized} transações. Tente novamente amanhã.`)
        } else {
          const msg = `Lote ${numLote}: ${errStr}`
          console.error('[categorizar]', msg)
          erros.push(msg)
        }
      }
    }

    if (jobId) {
      await supabase.from('categorization_jobs').update({
        status: 'done',
        categorized: totalCategorized,
        cota_diaria_esgotada: cotaDiariaEsgotada,
        erros: erros.length > 0 ? erros : null,
        finished_at: new Date().toISOString(),
      }).eq('id', jobId)
    }

    return NextResponse.json({
      categorized: totalCategorized,
      total: transacoes.length,
      cotaDiariaEsgotada,
      erros: erros.length > 0 ? erros : undefined,
    })
  } catch (error) {
    console.error('[categorizar]', error)
    if (jobId) {
      await supabase.from('categorization_jobs')
        .update({ status: 'error', finished_at: new Date().toISOString() })
        .eq('id', jobId)
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
