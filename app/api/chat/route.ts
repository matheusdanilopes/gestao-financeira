import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildAIContext } from '@/lib/ai/contextBuilder'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import type { TelaAtual } from '@/lib/ai/types'

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const WINDOW_SIZE = 15
const SUMMARY_TRIGGER = 20

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      'placeholder'
  )
}

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

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: 8192, temperature: 0.6 },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 429) {
      const retryMatch = body.match(/"retryDelay":\s*"(\d+)s"/)
      const segundos = retryMatch ? parseInt(retryMatch[1]) : null
      const diaria = body.includes('GenerateRequestsPerDayPerProjectPerModel')
      throw Object.assign(new Error('QUOTA_429'), { diaria, segundos })
    }
    throw new Error(body)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ─── Conversation Management ──────────────────────────────────────────────────

async function garantirConversa(
  supabase: ReturnType<typeof getSupabase>,
  conversationId: string | null,
  userId: string
): Promise<string> {
  if (conversationId) {
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
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
  supabase: ReturnType<typeof getSupabase>,
  apiKey: string,
  conversationId: string
): Promise<Array<{ role: string; content: string }>> {
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

    const body = await req.json()

    // Legacy mode: caller sends full mensagens array (no conversation_id)
    if (body.mensagens && !body.pergunta && !body.conversation_id) {
      const legacyUserId = (body.user_id as string | undefined) ?? 'anonymous'
      const contexto = await buildAIContext(legacyUserId, '')
      const systemPrompt = buildSystemPrompt(contexto)
      const texto = await geminiChat(apiKey, systemPrompt, body.mensagens)
      return NextResponse.json({ resposta: texto })
    }

    // Stateful mode
    const {
      pergunta,
      dados,
      user_id = 'anonymous',
      tela,
    } = body as {
      pergunta?: string
      dados?: string
      user_id?: string
      tela?: TelaAtual
      conversation_id?: string
    }
    let { conversation_id } = body as { conversation_id?: string }

    if (!pergunta?.trim()) {
      return NextResponse.json({ error: 'pergunta é obrigatória' }, { status: 400 })
    }

    const supabase = getSupabase()

    conversation_id = await garantirConversa(supabase, conversation_id ?? null, user_id)

    const contextoConversa = await carregarContextoConversa(supabase, apiKey, conversation_id)

    const conteudoUsuario = dados?.trim()
      ? `Pergunta: ${pergunta}\n\nDados adicionais:\n${dados.trim()}`
      : pergunta

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

    // Build rich structured context using the new AI context system
    const contextoFinanceiro = await buildAIContext(user_id, pergunta, tela)
    const systemPrompt = buildSystemPrompt(contextoFinanceiro, summaryPreamble?.content)

    const resposta = await geminiChat(apiKey, systemPrompt, mensagensParaIA)

    await supabase.from('messages').insert({
      conversation_id,
      role: 'assistant',
      content: resposta,
    })

    return NextResponse.json({ resposta, conversation_id })
  } catch (err) {
    console.error('[chat]', err)
    if (err instanceof Error && err.message === 'QUOTA_429') {
      const e = err as Error & { diaria?: boolean; segundos?: number | null }
      return NextResponse.json({
        errorCode: 'QUOTA_429',
        diaria: e.diaria ?? false,
        segundos: e.segundos ?? null,
      }, { status: 429 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
