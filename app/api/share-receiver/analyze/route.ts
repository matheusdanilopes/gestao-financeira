import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { gerarRodada, GEMINI_MODEL_LEGADO } from '@/lib/ai/agent/geminiClient'

export const maxDuration = 30

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BASE64_BYTES = 10 * 1024 * 1024

// Retry com backoff exponencial — resolve race condition do CDN do Storage
async function fetchImageWithRetry(url: string): Promise<{ base64: string; mimeType: string }> {
  const delays = [0, 600, 1500]
  let lastErr: unknown
  for (const delay of delays) {
    if (delay > 0) await new Promise(r => setTimeout(r, delay))
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const mimeType = res.headers.get('content-type')?.split(';')[0].trim() || 'image/jpeg'
      return { base64: Buffer.from(buf).toString('base64'), mimeType }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

async function identificarProduto(
  base64: string,
  mimeType: string,
  deadlineMs: number
): Promise<{ nome: string; descricao: string | null; preco: number | null } | { erro: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { erro: 'GEMINI_API_KEY não configurada' }

  const prompt = `Analise a imagem e identifique o produto principal. Responda SOMENTE com um objeto JSON, sem nenhum texto antes ou depois:
{"nome":"Nome do produto, max 60 chars","descricao":"descricao curta ou null","preco":0.00}
Regras: nome max 60 chars. descricao max 100 chars ou null. preco em reais como numero (ex: 49.90) se visivel na imagem, senão null. Se nao houver produto claro, use nome "Produto compartilhado".`

  // Gemini com retentativas; se ele falhar, o Groq (visão) responde.
  let fullText: string
  try {
    const rodada = await gerarRodada({
      apiKey,
      modelo: GEMINI_MODEL_LEGADO,
      deadlineMs,
      temperature: 0.1,
      maxOutputTokens: 1024,
      thinkingBudget: 0,
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
    })
    fullText = rodada.texto.trim()
  } catch (e) {
    return { erro: `IA falhou: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}` }
  }

  if (!fullText) return { erro: 'IA texto vazio' }

  const normalised = fullText
    .replace(/[""„‟«»]/g, '"')
    .replace(/[''‚‛]/g, "'")

  const match = normalised.match(/\{[\s\S]*\}/)
  if (!match) return { erro: 'Sem JSON na resposta' }

  try {
    const parsed = JSON.parse(match[0]) as { nome?: string; descricao?: string; preco?: number | string | null }
    if (!parsed?.nome) return { erro: 'Campo nome ausente' }
    const precoRaw = parsed.preco != null ? Number(String(parsed.preco).replace(',', '.')) : null
    return {
      nome: String(parsed.nome).slice(0, 60),
      descricao: parsed.descricao ? String(parsed.descricao).slice(0, 100) : null,
      preco: precoRaw && isFinite(precoRaw) && precoRaw > 0 ? precoRaw : null,
    }
  } catch {
    return { erro: 'Parse falhou' }
  }
}

export async function POST(req: NextRequest) {
  // Orçamento da IA contado desde o início: o download da imagem já consome parte dos 30 s.
  const deadlineMs = Date.now() + 26_000
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: { id?: string; imageBase64?: string; imageMimeType?: string; criado_por?: string | null } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { id, imageBase64, imageMimeType, criado_por } = body ?? {}
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  if (imageBase64) {
    const mimeType = imageMimeType ?? 'image/jpeg'
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: 'Tipo de imagem não permitido' }, { status: 400 })
    }
    if (imageBase64.length > MAX_BASE64_BYTES) {
      return NextResponse.json({ error: 'Imagem muito grande' }, { status: 413 })
    }
  }

  const { data: item, error: fetchError } = await supabase
    .from('wishlist_items')
    .select('id, imagem_url, ai_status')
    .eq('id', id)
    .single()

  if (fetchError || !item) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  if (item.ai_status === 'identificado') {
    return NextResponse.json({ status: 'identificado' })
  }

  let base64: string
  let mimeType: string

  if (imageBase64) {
    base64 = imageBase64
    mimeType = imageMimeType ?? 'image/jpeg'
  } else {
    if (!item.imagem_url) {
      await supabase.from('wishlist_items').update({
        ai_status: 'nao_identificado',
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return NextResponse.json({ status: 'nao_identificado' })
    }

    try {
      const img = await fetchImageWithRetry(item.imagem_url)
      base64 = img.base64
      mimeType = img.mimeType
    } catch {
      await supabase.from('wishlist_items').update({
        ai_status: 'nao_identificado',
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return NextResponse.json({ status: 'nao_identificado' })
    }
  }

  const resultado = await identificarProduto(base64, mimeType, deadlineMs)

  if ('erro' in resultado) {
    await supabase.from('wishlist_items').update({
      ai_status: 'nao_identificado',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ status: 'nao_identificado' })
  }

  const { error: updateError } = await supabase.from('wishlist_items').update({
    nome: resultado.nome,
    descricao_ia: resultado.descricao,
    ...(resultado.preco != null ? { valor_estimado: resultado.preco } : {}),
    ...(criado_por ? { criado_por } : {}),
    ai_status: 'identificado',
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (updateError) {
    return NextResponse.json({ status: 'nao_identificado' })
  }

  return NextResponse.json({ status: 'identificado', nome: resultado.nome, descricao: resultado.descricao, preco: resultado.preco })
}
