import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { differenceInMonths, format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const WINDOW_SIZE = 15
const SUMMARY_TRIGGER = 20

// ─── Types ────────────────────────────────────────────────────────────────────

type Transacao = {
  descricao: string; valor: number; responsavel: string
  categoria: string | null; projeto_fatura: string; data: string
}

type Planejamento = {
  item: string; responsavel: string | null; valor_previsto: number
  categoria: string | null; mes_referencia: string
  parcela_atual: number | null; total_parcelas: number | null
}

type RawData = {
  transacoes: Transacao[]
  planejamento: Planejamento[]
  configuracoes: Array<{ chave: string; valor: string }>
  ts: number
}

// ─── Raw Data Cache (5-minute TTL avoids repeated DB round-trips) ─────────────

let _dataCache: RawData | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
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
      generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
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

// ─── Query Intent Detection ───────────────────────────────────────────────────

type Intent = {
  tipo: 'atual' | 'comparativo' | 'historico' | 'categoria' | 'planejamento' | 'geral'
  mesesFoco: string[]      // specific months to show in full detail
  categoriasFoco: string[] // categories to highlight with cross-month breakdown
}

function detectarIntencao(pergunta: string): Intent {
  const p = pergunta.toLowerCase()
  const hoje = new Date()
  const mesAtual = format(hoje, 'yyyy-MM')

  const mesesNomes: Record<string, number> = {
    janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  }

  const mesesFoco: string[] = []
  const anoMatch = p.match(/\b(20\d{2})\b/)
  const ano = anoMatch ? parseInt(anoMatch[1]) : hoje.getFullYear()

  for (const [nome, num] of Object.entries(mesesNomes)) {
    if (new RegExp(`\\b${nome}\\b`).test(p)) {
      const m = `${ano}-${String(num).padStart(2, '0')}`
      if (!mesesFoco.includes(m)) mesesFoco.push(m)
    }
  }

  if (/\b(este|esse|atual|corrente)\s*m[eê]s\b/.test(p) && !mesesFoco.includes(mesAtual))
    mesesFoco.push(mesAtual)

  if (/\b(m[eê]s\s*)?(passado|anterior)\b/.test(p)) {
    const mp = format(subMonths(hoje, 1), 'yyyy-MM')
    if (!mesesFoco.includes(mp)) mesesFoco.push(mp)
  }

  const catKeywords: Record<string, string[]> = {
    'Alimentação': ['alimenta', 'comida', 'mercado', 'supermercado', 'restaurante', 'refeição', 'lanche', 'ifood', 'delivery', 'padaria'],
    'Saúde': ['saúde', 'saude', 'médico', 'medico', 'farmácia', 'farmacia', 'remédio', 'remedio', 'consulta', 'plano de saúde'],
    'Transporte': ['transporte', 'combustível', 'combustivel', 'gasolina', 'uber', 'táxi', 'taxi', 'carro'],
    'Entretenimento': ['entretenimento', 'lazer', 'netflix', 'streaming', 'cinema', 'jogo', 'spotify'],
    'Educação': ['educação', 'educacao', 'escola', 'faculdade', 'curso', 'livro'],
    'Casa': ['aluguel', 'condomínio', 'condominio', 'energia', 'internet', 'mobília'],
    'Vestuário': ['roupa', 'vestuário', 'vestuario', 'calçado', 'calcado', 'moda'],
  }

  const categoriasFoco: string[] = []
  for (const [cat, kws] of Object.entries(catKeywords)) {
    if (kws.some(kw => p.includes(kw))) categoriasFoco.push(cat)
  }

  let tipo: Intent['tipo'] = 'atual'
  if (/planejamento|orçamento|orcamento|previsto|budget/.test(p)) tipo = 'planejamento'
  else if (/compar|versus|evolução|evolu|tendência|tendencia|variação|varia/.test(p)) tipo = 'comparativo'
  else if (/histórico|historico|média\s*mensal|média\s*geral|todos\s*os\s*meses/.test(p)) tipo = 'historico'
  else if (categoriasFoco.length > 0 && mesesFoco.length === 0) tipo = 'categoria'
  else if (mesesFoco.length > 0 && !mesesFoco.includes(mesAtual)) tipo = 'historico'

  return { tipo, mesesFoco, categoriasFoco }
}

// ─── Data Fetching with Cache ─────────────────────────────────────────────────

async function fetchRawData(): Promise<RawData> {
  const now = Date.now()
  if (_dataCache && now - _dataCache.ts < CACHE_TTL_MS) return _dataCache

  const supabase = getSupabase()
  const limite = format(startOfMonth(subMonths(new Date(), 24)), 'yyyy-MM-dd')

  const [r1, r2, r3] = await Promise.all([
    supabase.from('transacoes_nubank')
      .select('descricao, valor, responsavel, categoria, projeto_fatura, data')
      .gte('projeto_fatura', limite)
      .order('projeto_fatura', { ascending: false }),
    supabase.from('planejamento')
      .select('item, responsavel, valor_previsto, categoria, mes_referencia, parcela_atual, total_parcelas')
      .gte('mes_referencia', limite)
      .order('mes_referencia', { ascending: false }),
    supabase.from('configuracoes').select('chave, valor'),
  ])

  _dataCache = {
    transacoes: (r1.data ?? []) as Transacao[],
    planejamento: (r2.data ?? []) as Planejamento[],
    configuracoes: (r3.data ?? []) as Array<{ chave: string; valor: string }>,
    ts: now,
  }
  return _dataCache
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

const fmtR = (v: number) => `R$ ${v.toFixed(2)}`

const fmtMes = (mes: string) => {
  try { return format(new Date(mes + '-02'), 'MMM/yyyy', { locale: ptBR }).toUpperCase() }
  catch { return mes }
}

function topCats(lista: Transacao[], n = 5): Array<[string, number]> {
  const acc: Record<string, number> = {}
  for (const t of lista) {
    const cat = t.categoria || 'Sem categoria'
    acc[cat] = (acc[cat] ?? 0) + t.valor
  }
  return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, n)
}

function varPct(atual: number, anterior: number | undefined): string {
  if (!anterior || anterior === 0) return ''
  const p = ((atual - anterior) / anterior * 100).toFixed(1)
  return ` (${parseFloat(p) >= 0 ? '+' : ''}${p}% vs ant)`
}

// ─── Context Formatters (tiered detail) ──────────────────────────────────────

function formatMesDetalhe(
  mes: string,
  lista: Transacao[],
  plan: Planejamento[],
  totalAnterior?: number,
): string {
  const total = lista.reduce((a, t) => a + t.valor, 0)
  const mat = lista.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const jen = lista.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)

  let s = `\n▌ ${fmtMes(mes)} — ${fmtR(total)}${varPct(total, totalAnterior)} | M: ${fmtR(mat)} | J: ${fmtR(jen)}\n`
  s += `  Categorias: ${topCats(lista).map(([c, v]) => `${c} ${fmtR(v)}`).join(' · ')}\n`

  if (plan.length > 0) {
    const totalPlan = plan.reduce((a, p) => a + p.valor_previsto, 0)
    const delta = total - totalPlan
    s += `  Orçamento: previsto ${fmtR(totalPlan)} → realizado ${fmtR(total)} (delta ${delta >= 0 ? '+' : ''}${fmtR(delta)})\n`
    for (const p of plan) {
      const parc = p.parcela_atual && p.total_parcelas ? ` (${p.parcela_atual}/${p.total_parcelas})` : ''
      s += `    · ${p.item}${parc}: ${fmtR(p.valor_previsto)}\n`
    }
  }

  const top = [...lista].sort((a, b) => b.valor - a.valor).slice(0, 15)
  s += `  Top transações:\n`
  for (const t of top) {
    s += `    ${t.responsavel[0]} ${t.descricao} ${fmtR(t.valor)}${t.categoria ? ` [${t.categoria}]` : ''}\n`
  }
  return s
}

function formatMesResumido(mes: string, lista: Transacao[], nCats = 5, nTx = 3): string {
  const total = lista.reduce((a, t) => a + t.valor, 0)
  const mat = lista.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const jen = lista.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)
  const cats = topCats(lista, nCats).map(([c, v]) => `${c} ${fmtR(v)}`).join(' · ')

  let s = `  ${fmtMes(mes)}: ${fmtR(total)} (M:${fmtR(mat)} J:${fmtR(jen)}) · ${cats}\n`
  if (nTx > 0) {
    const top = [...lista].sort((a, b) => b.valor - a.valor).slice(0, nTx)
    s += `    ↳ ${top.map(t => `${t.descricao} ${fmtR(t.valor)}`).join(', ')}\n`
  }
  return s
}

// ─── Behaviour Profile ────────────────────────────────────────────────────────

function buildPerfilComportamento(
  tpm: Record<string, Transacao[]>,
  meses: string[],
): string {
  if (meses.length < 2) return ''

  const totais = meses.map(m => (tpm[m] ?? []).reduce((a, t) => a + t.valor, 0))
  const media = totais.reduce((a, v) => a + v, 0) / totais.length

  const u3 = meses.slice(0, 3)
  const a3 = meses.slice(3, 6)
  const mediaU3 = u3.length
    ? u3.reduce((a, m) => a + ((tpm[m] ?? []).reduce((s, t) => s + t.valor, 0)), 0) / u3.length
    : 0
  const mediaA3 = a3.length
    ? a3.reduce((a, m) => a + ((tpm[m] ?? []).reduce((s, t) => s + t.valor, 0)), 0) / a3.length
    : 0

  const tendStr = mediaA3 > 0
    ? (() => {
        const p = ((mediaU3 - mediaA3) / mediaA3 * 100).toFixed(1)
        return `${parseFloat(p) >= 0 ? '↑' : '↓'} ${Math.abs(parseFloat(p))}% (últ 3 vs 3 anteriores)`
      })()
    : 'histórico insuficiente'

  const catAcc: Record<string, number> = {}
  for (const m of meses)
    for (const t of (tpm[m] ?? []))
      catAcc[t.categoria || 'Sem categoria'] = (catAcc[t.categoria || 'Sem categoria'] ?? 0) + t.valor

  const topCats5 = Object.entries(catAcc).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const peakIdx = totais.indexOf(Math.max(...totais))

  return `\nPERFIL FINANCEIRO:
  Média mensal (${meses.length}m): ${fmtR(media)} | Média últ 3m: ${fmtR(mediaU3)} | Tendência: ${tendStr}
  Pico: ${fmtMes(meses[peakIdx])} (${fmtR(totais[peakIdx])})
  Top categorias históricas: ${topCats5.map(([c, v]) => `${c} ${fmtR(v)}`).join(' · ')}\n`
}

// ─── Smart Context Builder ────────────────────────────────────────────────────

async function buildSmartContext(pergunta: string): Promise<string> {
  const data = await fetchRawData()
  const intent = detectarIntencao(pergunta)
  const hoje = new Date()
  const mesAtual = format(hoje, 'yyyy-MM')
  const mesAnterior = format(subMonths(hoje, 1), 'yyyy-MM')

  const { transacoes, planejamento, configuracoes } = data

  const tpm: Record<string, Transacao[]> = {}
  for (const t of transacoes) {
    const m = (t.projeto_fatura ?? '').substring(0, 7)
    if (!tpm[m]) tpm[m] = []
    tpm[m].push(t)
  }

  const planPM: Record<string, Planejamento[]> = {}
  for (const p of planejamento) {
    const m = (p.mes_referencia ?? '').substring(0, 7)
    if (!planPM[m]) planPM[m] = []
    planPM[m].push(p)
  }

  const meses = Object.keys(tpm).sort().reverse()
  const totalGeral = transacoes.reduce((a, t) => a + t.valor, 0)
  const totalMat = transacoes.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const totalJen = transacoes.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)

  let ctx = `DADOS FINANCEIROS — MATHEUS & JENIFFER
Data: ${format(hoje, 'dd/MM/yyyy')} | ${meses.length} meses | ${transacoes.length} transações
Histórico total: ${fmtR(totalGeral)} (M: ${fmtR(totalMat)} | J: ${fmtR(totalJen)})\n`

  if (configuracoes.length > 0)
    ctx += `Configurações: ${configuracoes.map(c => `${c.chave}=${c.valor}`).join(', ')}\n`

  ctx += buildPerfilComportamento(tpm, meses)

  // Months that always get full detail: current, previous, any explicitly mentioned
  const detalhe = new Set([mesAtual, mesAnterior, ...intent.mesesFoco])

  // Expand detail window for comparative/historical queries
  if (intent.tipo === 'comparativo' || intent.tipo === 'historico' || intent.tipo === 'planejamento')
    meses.slice(0, 4).forEach(m => detalhe.add(m))

  const detailMeses = meses.filter(m => detalhe.has(m) && (tpm[m]?.length ?? 0) > 0)

  if (detailMeses.length > 0) {
    ctx += '\n══ DETALHE ══\n'
    for (const m of detailMeses) {
      const mAnt = format(subMonths(new Date(m + '-02'), 1), 'yyyy-MM')
      const totalAnt = tpm[mAnt]?.reduce((a, t) => a + t.valor, 0)
      ctx += formatMesDetalhe(m, tpm[m] ?? [], planPM[m] ?? [], totalAnt)
    }
  }

  // Months 2-6 not already in detail → category summary + top 3 tx
  const recentes = meses.filter(m => {
    if (detalhe.has(m)) return false
    const diff = differenceInMonths(new Date(mesAtual + '-01'), new Date(m + '-01'))
    return diff >= 2 && diff <= 6
  })
  if (recentes.length > 0) {
    ctx += '\n══ ÚLTIMOS 6 MESES ══\n'
    recentes.forEach(m => { if ((tpm[m]?.length ?? 0) > 0) ctx += formatMesResumido(m, tpm[m], 5, 3) })
  }

  // Months 7-12 → top 3 categories only, no individual transactions
  const historico = meses.filter(m => {
    if (detalhe.has(m) || recentes.includes(m)) return false
    const diff = differenceInMonths(new Date(mesAtual + '-01'), new Date(m + '-01'))
    return diff >= 7 && diff <= 12
  })
  if (historico.length > 0) {
    ctx += '\n══ 7-12 MESES ══\n'
    historico.forEach(m => { if ((tpm[m]?.length ?? 0) > 0) ctx += formatMesResumido(m, tpm[m], 3, 0) })
  }

  // Months 13-24 → single line totals only
  const antigos = meses.filter(m => !detalhe.has(m) && !recentes.includes(m) && !historico.includes(m))
  if (antigos.length > 0) {
    ctx += '\n══ 13-24 MESES ══\n'
    for (const m of antigos) {
      const lista = tpm[m] ?? []
      const total = lista.reduce((a, t) => a + t.valor, 0)
      if (total > 0) {
        const mat = lista.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
        const jen = lista.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)
        ctx += `  ${fmtMes(m)}: ${fmtR(total)} (M:${fmtR(mat)} J:${fmtR(jen)}) [${lista.length}tx]\n`
      }
    }
  }

  // Category cross-month breakdown when query is category-focused
  if (intent.categoriasFoco.length > 0) {
    ctx += `\n══ FOCO: ${intent.categoriasFoco.join(' + ').toUpperCase()} ══\n`
    for (const cat of intent.categoriasFoco) {
      const txCat = transacoes.filter(t => t.categoria === cat)
      const totalCat = txCat.reduce((a, t) => a + t.valor, 0)
      const porMes = Object.entries(
        txCat.reduce((acc, t) => {
          const m = (t.projeto_fatura ?? '').substring(0, 7)
          acc[m] = (acc[m] ?? 0) + t.valor
          return acc
        }, {} as Record<string, number>)
      ).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)

      ctx += `  ${cat}: ${fmtR(totalCat)} total | ${porMes.map(([m, v]) => `${fmtMes(m)} ${fmtR(v)}`).join(' · ')}\n`
    }
  }

  return ctx
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

function montarMensagemUsuario(pergunta: string, dados?: string): string {
  if (!dados?.trim()) return pergunta
  return `Pergunta: ${pergunta}\n\nDados:\n${dados.trim()}`
}

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(contextoFinanceiro: string, summaryPreamble?: string): string {
  const resumoPart = summaryPreamble
    ? `\nRESUMO DA CONVERSA ANTERIOR:\n${summaryPreamble.replace('[RESUMO] ', '')}\n`
    : ''

  return `Você é um analista financeiro pessoal do casal Matheus e Jeniffer.
Analise os dados abaixo e responda em português brasileiro. Formate valores como R$ X,XX.
Seja direto e objetivo: cite números específicos, identifique tendências e sugira ações concretas.
Não trunce respostas — conclua completamente o que começar.
${resumoPart}
${contextoFinanceiro}`
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
      const contexto = await buildSmartContext('')
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

    conversation_id = await garantirConversa(supabase, conversation_id ?? null, user_id)

    const contextoConversa = await carregarContextoConversa(supabase, apiKey, conversation_id)

    const conteudoUsuario = montarMensagemUsuario(pergunta, dados)
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
    const contextoFinanceiro = await buildSmartContext(pergunta)
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
