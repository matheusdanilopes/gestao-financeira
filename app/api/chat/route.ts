import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// Max non-system messages to send to the AI in a single turn
const WINDOW_SIZE = 15
// When total non-system messages exceed this, create a summary of overflow
const SUMMARY_TRIGGER = 20

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

async function geminiChat(
  apiKey: string,
  systemPrompt: string,
  mensagens: Array<{ role: string; content: string }>
) {
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Entendido! Estou pronto para analisar os dados e responder suas perguntas.' }] },
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
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
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

async function buscarContextoFinanceiro(): Promise<string> {
  const supabase = getSupabase()

  const limiteHistorico = format(startOfMonth(subMonths(new Date(), 24)), 'yyyy-MM-dd')

  const [resTransacoes, resPlanejamento, resConfig] = await Promise.all([
    supabase.from('transacoes_nubank')
      .select('descricao, valor, responsavel, categoria, projeto_fatura, data')
      .gte('projeto_fatura', limiteHistorico)
      .order('projeto_fatura', { ascending: false }),
    supabase.from('planejamento')
      .select('item, responsavel, valor_previsto, categoria, mes_referencia, parcela_atual, total_parcelas')
      .gte('mes_referencia', limiteHistorico)
      .order('mes_referencia', { ascending: false }),
    supabase.from('configuracoes').select('chave, valor'),
  ])

  const transacoes = (resTransacoes.data ?? []) as Array<{
    descricao: string; valor: number; responsavel: string; categoria: string | null
    projeto_fatura: string; data: string
  }>
  const planejamento = (resPlanejamento.data ?? []) as Array<{
    item: string; responsavel: string | null; valor_previsto: number; categoria: string | null
    mes_referencia: string; parcela_atual: number | null; total_parcelas: number | null
  }>
  const configuracoes = (resConfig.data ?? []) as Array<{ chave: string; valor: string }>

  const hoje = new Date()

  const configStr = configuracoes.length > 0
    ? configuracoes.map(c => `  ${c.chave}: ${c.valor}`).join('\n')
    : '  (nenhuma)'

  const transacoesPorMes: Record<string, typeof transacoes> = {}
  for (const t of transacoes) {
    const mes = (t.projeto_fatura ?? '').substring(0, 7)
    if (!transacoesPorMes[mes]) transacoesPorMes[mes] = []
    transacoesPorMes[mes].push(t)
  }

  const mesesTransacoes = Object.keys(transacoesPorMes).sort().reverse()

  let transacoesStr = ''
  for (const mes of mesesTransacoes) {
    const lista = transacoesPorMes[mes]
    const total = lista.reduce((a, t) => a + t.valor, 0)
    const matheus = lista.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
    const jeniffer = lista.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)
    const nomeMes = format(new Date(mes + '-02'), 'MMMM yyyy', { locale: ptBR })

    transacoesStr += `\n### Fatura ${nomeMes.toUpperCase()} — Total: R$ ${total.toFixed(2)} | Matheus: R$ ${matheus.toFixed(2)} | Jeniffer: R$ ${jeniffer.toFixed(2)}\n`

    const porCat: Record<string, number> = {}
    for (const t of lista) {
      const cat = t.categoria || 'Sem categoria'
      porCat[cat] = (porCat[cat] ?? 0) + t.valor
    }
    transacoesStr += 'Categorias: ' + Object.entries(porCat).sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${c} R$ ${v.toFixed(2)}`).join(' | ') + '\n'

    const linhas = [...lista].sort((a, b) => b.valor - a.valor)
      .map(t => `  [${t.responsavel}] ${t.descricao} — R$ ${t.valor.toFixed(2)}${t.categoria ? ` (${t.categoria})` : ''}`)
    transacoesStr += linhas.join('\n') + '\n'
  }

  const planPorMes: Record<string, typeof planejamento> = {}
  for (const p of planejamento) {
    const mes = (p.mes_referencia ?? '').substring(0, 7)
    if (!planPorMes[mes]) planPorMes[mes] = []
    planPorMes[mes].push(p)
  }

  let planejamentoStr = ''
  for (const mes of Object.keys(planPorMes).sort().reverse()) {
    const lista = planPorMes[mes]
    const nomeMes = format(new Date(mes + '-02'), 'MMMM yyyy', { locale: ptBR })
    planejamentoStr += `\n### Planejamento ${nomeMes.toUpperCase()}\n`
    for (const p of lista) {
      const parc = p.parcela_atual && p.total_parcelas ? ` (parcela ${p.parcela_atual}/${p.total_parcelas})` : ''
      planejamentoStr += `  ${p.item}${parc}: R$ ${p.valor_previsto.toFixed(2)}${p.categoria ? ` [${p.categoria}]` : ''}\n`
    }
  }

  const totalGeral = transacoes.reduce((a, t) => a + t.valor, 0)
  const totalMatheus = transacoes.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const totalJeniffer = transacoes.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)

  return `
ASSISTENTE FINANCEIRO — DADOS COMPLETOS DO CASAL MATHEUS E JENIFFER
Data de referência: ${format(hoje, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}

CONFIGURAÇÕES:
${configStr}

RESUMO HISTÓRICO GERAL:
  Total histórico de gastos no cartão: R$ ${totalGeral.toFixed(2)}
  Total Matheus: R$ ${totalMatheus.toFixed(2)}
  Total Jeniffer: R$ ${totalJeniffer.toFixed(2)}
  Meses com dados: ${mesesTransacoes.length}
  Total de transações: ${transacoes.length}

═══════════════════════════════════════
TRANSAÇÕES POR MÊS DE FATURA:
${transacoesStr}
═══════════════════════════════════════
PLANEJAMENTO MENSAL:
${planejamentoStr}
`.trim()
}

// Ensures a conversation exists for the user; returns its id
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

// Generates a condensed summary of old messages to preserve context
async function gerarResumo(
  apiKey: string,
  mensagens: Array<{ role: string; content: string }>
): Promise<string> {
  const texto = mensagens
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
    .join('\n\n')

  const contents = [
    {
      role: 'user',
      parts: [{
        text: `Resuma de forma concisa (máximo 300 palavras) os pontos principais desta conversa financeira, preservando dados numéricos e conclusões importantes:\n\n${texto}\n\nResumo:`,
      }],
    },
  ]

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 1024, temperature: 0.3 } }),
  })

  if (!res.ok) return '(histórico anterior não disponível)'
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '(histórico anterior não disponível)'
}

// Loads conversation context with hybrid window + summarization strategy
async function carregarContextoConversa(
  supabase: ReturnType<typeof getSupabase>,
  apiKey: string,
  conversationId: string
): Promise<Array<{ role: string; content: string }>> {
  // Count non-system messages
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('role', 'system')

  const total = count ?? 0

  // Fetch last WINDOW_SIZE non-system messages (most recent first, then reverse)
  const { data: recentData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: false })
    .limit(WINDOW_SIZE)

  const recent = (recentData ?? []).reverse()

  if (total <= WINDOW_SIZE) {
    return recent
  }

  // Check for an existing system summary
  const { data: summaryData } = await supabase
    .from('messages')
    .select('content')
    .eq('conversation_id', conversationId)
    .eq('role', 'system')
    .ilike('content', '[RESUMO]%')
    .order('created_at', { ascending: false })
    .limit(1)

  if (summaryData?.[0]?.content) {
    return [{ role: 'system', content: summaryData[0].content }, ...recent]
  }

  // No summary yet — summarize overflow messages
  if (total <= SUMMARY_TRIGGER) {
    // Not enough overflow to warrant summarization; just use window
    return recent
  }

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

function montarMensagemUsuario(pergunta: string, dados?: string): string {
  if (!dados?.trim()) return pergunta
  return `Pergunta: ${pergunta}\n\nDados:\n${dados.trim()}`
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const body = await req.json()

    // Legacy mode: caller sends full mensagens array (no conversation_id)
    if (body.mensagens && !body.pergunta && !body.conversation_id) {
      const contexto = await buscarContextoFinanceiro()
      const systemPrompt = buildSystemPrompt(contexto)
      const texto = await geminiChat(apiKey, systemPrompt, body.mensagens)
      return NextResponse.json({ resposta: texto })
    }

    // Stateful mode
    const { pergunta, dados, user_id = 'anonymous' } = body as {
      pergunta?: string
      dados?: string
      user_id?: string
      conversation_id?: string
    }
    let { conversation_id } = body as { conversation_id?: string }

    if (!pergunta?.trim()) {
      return NextResponse.json({ error: 'pergunta é obrigatória' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Ensure conversation exists
    conversation_id = await garantirConversa(supabase, conversation_id ?? null, user_id)

    // Load windowed context (with summary if needed)
    const contextoConversa = await carregarContextoConversa(supabase, apiKey, conversation_id)

    // Persist user message
    const conteudoUsuario = montarMensagemUsuario(pergunta, dados)
    await supabase.from('messages').insert({
      conversation_id,
      role: 'user',
      content: conteudoUsuario,
    })

    // Build messages array for AI: context + new user message
    const mensagensParaIA = [
      ...contextoConversa.filter(m => m.role !== 'system'),
      { role: 'user', content: conteudoUsuario },
    ]

    // System messages from context go into system prompt preamble
    const summaryPreamble = contextoConversa.find(m => m.role === 'system')
    const contextoFinanceiro = await buscarContextoFinanceiro()
    const systemPrompt = buildSystemPrompt(contextoFinanceiro, summaryPreamble?.content)

    const resposta = await geminiChat(apiKey, systemPrompt, mensagensParaIA)

    // Persist assistant response
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

function buildSystemPrompt(contextoFinanceiro: string, summaryPreamble?: string): string {
  const resumoPart = summaryPreamble
    ? `\nCONTEXTO DA CONVERSA ANTERIOR:\n${summaryPreamble.replace('[RESUMO] ', '')}\n`
    : ''

  return `Você é um analista de dados sênior e assistente financeiro pessoal do casal Matheus e Jeniffer.
- Interprete métricas e padrões financeiros
- Identifique anomalias e tendências
- Sugira insights acionáveis
- Seja direto e estruturado
Responda sempre em português brasileiro. Formate valores monetários como R$ X.XX.
Quando comparar períodos, use os dados históricos disponíveis.
IMPORTANTE: Nunca corte ou trunce suas respostas. Sempre conclua completamente o que começou a escrever.
${resumoPart}
${contextoFinanceiro}`
}
