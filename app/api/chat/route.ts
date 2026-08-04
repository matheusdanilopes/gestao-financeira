import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { buildChatContext, buildDomainExtra, KNOWN_DOMAINS, type ContextDomain } from '@/lib/ai/financialContextEngine'
import { consultarTransacoes, consultarPlanejamento } from '@/lib/ai/consultaTool'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import { CATEGORIAS_PADRAO } from '@/lib/categorias'
import type { TelaAtual, EnrichedData, FinancialInsightsContext } from '@/lib/ai/types'

// The retry loop below can take up to ~58s in the worst case (backoff +
// timeouts on repeated 503s) — without this, the route falls back to the
// platform default, which is too short and would let a slow retry get
// killed mid-flight (surfacing as a non-JSON "erro de conexão" to the user).
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const WINDOW_SIZE = 15
const SUMMARY_TRIGGER = 20

// ─── Fase C/E: busca sob demanda via function-calling nativo do Gemini ───────
// Só habilitada em follow-ups com dataset validado (ver toolsEnabled no POST
// handler). Todo parâmetro é validado/normalizado em consultaTool.ts e
// financialContextEngine.ts antes de tocar em qualquer dado — nunca SQL
// bruto, apenas filtros estruturados sobre o EnrichedData já buscado e
// validado neste turno (sem nova consulta ao banco, sem role/credencial
// nova). Ver "Fase E" do plano para o porquê de não ser um run_sql aberto.
const FINANCIAL_TOOL = {
  functionDeclarations: [
    {
      name: 'buscar_dados_financeiros',
      description:
        'Busca dados financeiros adicionais compactos para um ou mais domínios quando o contexto já fornecido não é suficiente para responder com precisão.',
      parameters: {
        type: 'OBJECT',
        properties: {
          dominios: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: KNOWN_DOMAINS },
          },
        },
        required: ['dominios'],
      },
    },
    {
      name: 'consultar_transacoes',
      description:
        'Consulta transações de cartão com filtros combinados (categoria, responsável, cartão, intervalo de meses) quando buscar_dados_financeiros não cobrir a combinação exata perguntada. Retorna um resumo compacto (total, por mês, maiores itens) — nunca a lista completa.',
      parameters: {
        type: 'OBJECT',
        properties: {
          categoria: { type: 'STRING', enum: CATEGORIAS_PADRAO },
          responsavel: { type: 'STRING', enum: ['Matheus', 'Jeniffer'] },
          cartao: { type: 'STRING', enum: ['nubank', 'cartao1', 'cartao2'] },
          mesInicio: { type: 'STRING', description: 'Mês inicial no formato YYYY-MM' },
          mesFim: { type: 'STRING', description: 'Mês final no formato YYYY-MM' },
        },
      },
    },
    {
      name: 'consultar_planejamento',
      description:
        'Consulta despesas fixas planejadas com filtros combinados (categoria, responsável, intervalo de meses, se já foi pago) quando buscar_dados_financeiros não cobrir a combinação exata perguntada. Retorna um resumo compacto — nunca a lista completa.',
      parameters: {
        type: 'OBJECT',
        properties: {
          categoria: { type: 'STRING', enum: CATEGORIAS_PADRAO },
          responsavel: { type: 'STRING', enum: ['Matheus', 'Jeniffer'] },
          mesInicio: { type: 'STRING', description: 'Mês inicial no formato YYYY-MM' },
          mesFim: { type: 'STRING', description: 'Mês final no formato YYYY-MM' },
          pago: { type: 'BOOLEAN' },
        },
      },
    },
  ],
}

// Dispatches a functionCall by name to its handler, all operating on the
// EnrichedData/metrics already fetched this turn — returns null for an
// unknown/hallucinated tool name so the caller can fall back gracefully.
function executarTool(
  name: string,
  args: Record<string, unknown>,
  data: EnrichedData,
  metrics: FinancialInsightsContext,
  pergunta: string,
  hoje: Date
): string | null {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

  switch (name) {
    case 'buscar_dados_financeiros': {
      const requested = Array.isArray(args?.dominios)
        ? (args.dominios as unknown[]).filter((d): d is string => typeof d === 'string')
        : []
      const valid = requested.filter((d): d is ContextDomain => (KNOWN_DOMAINS as string[]).includes(d))
      const extra = valid
        .map(d => buildDomainExtra(d, data, metrics, pergunta, hoje))
        .filter(Boolean)
        .join('\n\n')
      return extra || 'Nenhum dado adicional disponível para os domínios solicitados.'
    }

    case 'consultar_transacoes':
      return consultarTransacoes(data, {
        categoria: str(args?.categoria),
        responsavel: str(args?.responsavel),
        cartao: str(args?.cartao),
        mesInicio: str(args?.mesInicio),
        mesFim: str(args?.mesFim),
      })

    case 'consultar_planejamento':
      return consultarPlanejamento(data, {
        categoria: str(args?.categoria),
        responsavel: str(args?.responsavel),
        mesInicio: str(args?.mesInicio),
        mesFim: str(args?.mesFim),
        pago: typeof args?.pago === 'boolean' ? args.pago : undefined,
      })

    default:
      return null
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: { name: string; content: unknown } }
}

interface GeminiContent {
  role: string
  parts: GeminiPart[]
}

type GeminiResult =
  | { type: 'text'; text: string }
  | { type: 'functionCall'; name: string; args: Record<string, unknown> }

function buildContents(
  systemPrompt: string,
  mensagens: Array<{ role: string; content: string }>
): GeminiContent[] {
  return [
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
}

async function geminiChat(
  apiKey: string,
  contents: GeminiContent[],
  opts: { tools?: Array<typeof FINANCIAL_TOOL>; deadlineMs: number }
): Promise<GeminiResult> {
  const body = JSON.stringify({
    contents,
    ...(opts.tools ? { tools: opts.tools } : {}),
    generationConfig: { maxOutputTokens: 8192, temperature: 0.6 },
  })

  // Gemini occasionally returns transient 502/503 ("model overloaded") under
  // load — the preview model used here is especially prone to this. Without a
  // retry, a single blip surfaces to the user as "não consegui responder
  // agora" even though the very next attempt would have worked. Google's own
  // guidance for UNAVAILABLE/503 is exponential backoff, so retries grow
  // 1.5s → 3s → 6s instead of the flat delay used for other transient errors.
  //
  // deadlineMs is a wall-clock budget shared across BOTH calls of a possible
  // function-calling round trip (Fase C) — without it, two independent
  // per-call retry budgets could together exceed the platform's maxDuration
  // and get killed mid-flight instead of degrading gracefully.
  const MAX_RETRIES = 3
  const ATTEMPT_TIMEOUT_MS = 12_000
  let lastError: Error | null = null
  let lastStatusOverloaded = false

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (Date.now() >= opts.deadlineMs) break

    if (attempt > 0) {
      const delay = lastStatusOverloaded ? 1500 * 2 ** (attempt - 1) : attempt * 800
      const remaining = opts.deadlineMs - Date.now()
      if (remaining <= 0) break
      await new Promise(r => setTimeout(r, Math.min(delay, remaining)))
    }

    const controller = new AbortController()
    const timeoutMs = Math.max(1000, Math.min(ATTEMPT_TIMEOUT_MS, opts.deadlineMs - Date.now()))
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

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
      lastStatusOverloaded = false
      continue
    } finally {
      clearTimeout(timeoutId)
    }

    if (res.ok) {
      const data = await res.json()
      const parts = data.candidates?.[0]?.content?.parts ?? []
      const fnPart = parts.find((p: GeminiPart) => p.functionCall)
      if (fnPart?.functionCall) {
        return { type: 'functionCall', name: fnPart.functionCall.name, args: fnPart.functionCall.args ?? {} }
      }
      const text = parts.find((p: GeminiPart) => typeof p.text === 'string')?.text ?? ''
      if (text) return { type: 'text', text }
      // Empty text with no thrown error (e.g. safety block, MAX_TOKENS with no
      // content yet) — treat as a failure worth retrying instead of silently
      // returning a blank assistant bubble.
      lastError = new Error(`Gemini retornou resposta vazia (finishReason=${data.candidates?.[0]?.finishReason ?? 'UNKNOWN'})`)
      lastStatusOverloaded = false
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
    lastStatusOverloaded = res.status === 503 || res.status === 502 || res.status === 504
    // 502/503/504 → retry
  }

  if (lastStatusOverloaded) {
    throw Object.assign(new Error('MODEL_OVERLOADED'), { cause: lastError })
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
    // Fase B: 1-message lookback for short-range topic continuity (e.g. "e por
    // categoria?" right after a cartão question) — bounded to the immediately
    // preceding user turn, not the whole history.
    const perguntaAnterior = contextoConversa.filter(m => m.role === 'user').at(-1)?.content

    const ctxResult = await buildChatContext({ userId, pergunta: perguntaSafe, isFirstMessage, tela, perguntaAnterior })
    const systemPrompt = buildSystemPrompt(ctxResult.context, summaryPreamble?.content)

    // Fase C: only offer the on-demand data tool on follow-ups with a
    // validated dataset — on the first message the full context already
    // covers most cases, and a blocked/compromised dataset must never be
    // "topped up" via a tool call.
    const toolsEnabled = !isFirstMessage && !ctxResult.blocked
    const deadlineMs = Date.now() + 50_000
    const contents = buildContents(systemPrompt, mensagensParaIA)

    const first = await geminiChat(apiKey, contents, {
      tools: toolsEnabled ? [FINANCIAL_TOOL] : undefined,
      deadlineMs,
    })

    const respostaGenerica = 'Não consegui montar uma resposta completa agora — pode reformular a pergunta?'

    let resposta: string
    if (first.type === 'text') {
      resposta = first.text
    } else if (first.type === 'functionCall' && ctxResult.data && ctxResult.metrics && ctxResult.hoje) {
      const functionResponseContent = executarTool(
        first.name, first.args, ctxResult.data, ctxResult.metrics, perguntaSafe, ctxResult.hoje
      )

      if (functionResponseContent === null) {
        resposta = respostaGenerica
      } else {
        const followupContents: GeminiContent[] = [
          ...contents,
          { role: 'model', parts: [{ functionCall: { name: first.name, args: first.args } }] },
          {
            role: 'function',
            parts: [{ functionResponse: { name: first.name, response: { name: first.name, content: functionResponseContent } } }],
          },
        ]
        // No `tools` on the follow-up call: structurally prevents a second
        // function call, bounding this to at most two Gemini calls per turn.
        const second = await geminiChat(apiKey, followupContents, { deadlineMs })
        resposta = second.type === 'text' ? second.text : respostaGenerica
      }
    } else {
      resposta = respostaGenerica
    }

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
    if (err instanceof Error && err.message === 'MODEL_OVERLOADED') {
      return NextResponse.json({ errorCode: 'MODEL_OVERLOADED' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
