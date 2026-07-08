import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { buildChatContext } from '@/lib/ai/financialContextEngine'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import type { TelaAtual } from '@/lib/ai/types'

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const WINDOW_SIZE = 15
const SUMMARY_TRIGGER = 20

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function geminiChat(
  apiKey: string,
  systemPrompt: string,
  mensagens: Array<{ role: string; content: string }>
) {
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    {
      role: 'model',
      parts: [{ text: 'Entendido. Analisei os dados financeiros e estou pronto para responder com precisão.' }],
    },
    ...mensagens.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ]

  const body = JSON.stringify({
    contents,
    generationConfig: { maxOutputTokens: 8192, temperature: 0.6 },
  })

  // Gemini occasionally returns transient 502/503 under load. Without a retry,
  // a single blip surfaces to the user as "não consegui responder agora" even
  // though the very next attempt would have worked — mirrors /api/insights.
  const MAX_RETRIES = 2
  const ATTEMPT_TIMEOUT_MS = 15_000
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt * 800))
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
    } catch (err) {
      // Timeout/abort or network failure — retry like a transient server error
      // instead of letting the platform-level function timeout kill the whole
      // request (which returns a non-JSON page the client can't parse).
      lastError = err instanceof Error ? err : new Error('Falha de rede ao chamar o Gemini')
      continue
    } finally {
      clearTimeout(timeoutId)
    }

    if (res.ok) {
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (text) return text
      // Empty text with no thrown error (e.g. safety block, MAX_TOKENS with no
      // content yet) — treat as a failure worth retrying instead of silently
      // returning a blank assistant bubble.
      lastError = new Error(`Gemini retornou resposta vazia (finishReason=${data.candidates?.[0]?.finishReason ?? 'UNKNOWN'})`)
      continue
    }

    const text = await res.text()
    if (res.status === 429) {
      const retryMatch = text.match(/"retryDelay":\s*"(\d+)s"/)
      const segundos = retryMatch ? parseInt(retryMatch[1]) : null
      const diaria = text.includes('GenerateRequestsPerDayPerProjectPerModel')
      throw Object.assign(new Error('QUOTA_429'), { diaria, segundos })
    }
    // Don't retry on definitive client errors — only transient server errors
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      throw new Error(text)
    }
    lastError = new Error(text)
    // 502/503/504 → retry
  }

  throw lastError ?? new Error('Gemini: falha após retentativas')
}

// ─── Conversation Management ──────────────────────────────────────────────────

async function garantirConversa(
  supabase: ReturnType<typeof criarSupabaseServer>,
  conversationId: string | null,
  userId: string
): Promise<string> {
  if (conversationId) {
    // Verify conversation belongs to this user before loading
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()
    if (data?.id) return data.id
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single()

  if (error || !data?.id) throw new Error('Falha ao criar conversa: ' + (error?.message ?? 'unknown'))
  return data.id
}

async function gerarResumo(
  apiKey: string,
  mensagens: Array<{ role: string; content: string }>
): Promise<string> {
  const texto = mensagens
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
    .join('\n\n')

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: `Resuma de forma concisa (máximo 250 palavras) os pontos principais desta conversa financeira, preservando todos os valores numéricos e conclusões importantes:\n\n${texto}\n\nResumo:`,
        }],
      }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    }),
  })

  if (!res.ok) return '(histórico anterior não disponível)'
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '(histórico anterior não disponível)'
}

async function carregarContextoConversa(
  supabase: ReturnType<typeof criarSupabaseServer>,
  apiKey: string,
  conversationId: string,
  userId: string
): Promise<Array<{ role: string; content: string }>> {
  // Always scope message loading to conversations owned by this user
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('role', 'system')

  const total = count ?? 0

  const { data: recentData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: false })
    .limit(WINDOW_SIZE)

  const recent = (recentData ?? []).reverse()

  if (total <= WINDOW_SIZE) return recent

  const { data: summaryData } = await supabase
    .from('messages')
    .select('content')
    .eq('conversation_id', conversationId)
    .eq('role', 'system')
    .ilike('content', '[RESUMO]%')
    .order('created_at', { ascending: false })
    .limit(1)

  if (summaryData?.[0]?.content)
    return [{ role: 'system', content: summaryData[0].content }, ...recent]

  if (total <= SUMMARY_TRIGGER) return recent

  const { data: allData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: true })

  const allMessages = allData ?? []
  const oldMessages = allMessages.slice(0, allMessages.length - WINDOW_SIZE)
  if (oldMessages.length === 0) return recent

  const summaryText = await gerarResumo(apiKey, oldMessages)
  const resumoContent = `[RESUMO] ${summaryText}`

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'system',
    content: resumoContent,
  })

  return [{ role: 'system', content: resumoContent }, ...recent]
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const { user, supabase, unauthorized } = await requireAuth(req)
    if (unauthorized) return unauthorized

    const body = await req.json()

    // user_id always comes from the authenticated session — never from the request body
    const userId = user.id

    const {
      pergunta,
      dados,
      tela,
    } = body as {
      pergunta?: string
      dados?: string
      tela?: TelaAtual
      conversation_id?: string
    }
    let { conversation_id } = body as { conversation_id?: string }

    if (!pergunta?.trim()) {
      return NextResponse.json({ error: 'pergunta é obrigatória' }, { status: 400 })
    }

    // Sanitise user input length to prevent prompt injection via oversized payloads
    const perguntaSafe = pergunta.trim().slice(0, 2000)
    const dadosSafe = dados?.trim().slice(0, 5000)

    conversation_id = await garantirConversa(supabase, conversation_id ?? null, userId)

    const contextoConversa = await carregarContextoConversa(supabase, apiKey, conversation_id, userId)

    const conteudoUsuario = dadosSafe
      ? `Pergunta: ${perguntaSafe}\n\nDados adicionais:\n${dadosSafe}`
      : perguntaSafe

    await supabase.from('messages').insert({
      conversation_id,
      role: 'user',
      content: conteudoUsuario,
    })

    const mensagensParaIA = [
      ...contextoConversa.filter(m => m.role !== 'system'),
      { role: 'user', content: conteudoUsuario },
    ]

    const summaryPreamble = contextoConversa.find(m => m.role === 'system')

    const isFirstMessage = contextoConversa.filter(m => m.role !== 'system').length === 0
    const contextoFinanceiro = await buildChatContext({ userId, pergunta: perguntaSafe, isFirstMessage, tela })
    const systemPrompt = buildSystemPrompt(contextoFinanceiro, summaryPreamble?.content)

    const resposta = await geminiChat(apiKey, systemPrompt, mensagensParaIA)

    await supabase.from('messages').insert({
      conversation_id,
      role: 'assistant',
      content: resposta,
    })

    return NextResponse.json({ resposta, conversation_id })
  } catch (err) {
    console.error('[chat]', err instanceof Error ? err.message : 'unknown error')
    if (err instanceof Error && err.message === 'QUOTA_429') {
      const e = err as Error & { diaria?: boolean; segundos?: number | null }
      return NextResponse.json({
        errorCode: 'QUOTA_429',
        diaria: e.diaria ?? false,
        segundos: e.segundos ?? null,
      }, { status: 429 })
    }
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
