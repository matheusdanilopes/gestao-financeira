// Central AI Context Builder — assembles structured context for every AI request

import { format, subMonths, startOfMonth, differenceInMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@supabase/supabase-js'
import { getMesEfetivo, nomeCartao } from './insightsEngine'
import type { EnrichedData, TelaAtual, Transacao } from './types'

// ─── Per-user cache ───────────────────────────────────────────────────────────
// Keyed by userId to prevent data leakage between users.
// Serverless functions are ephemeral — this cache lives for the lifetime of a
// single function instance and is never shared across users or requests from
// different users in the same instance, because userId is always the key.

const _userCache = new Map<string, { data: EnrichedData; ts: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 10 // prevent unbounded memory growth

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      'placeholder'
  )
}

export function clearEnrichedDataCache(userId: string): void {
  _userCache.delete(userId)
}

export async function fetchEnrichedData(userId: string, force = false): Promise<EnrichedData> {
  const now = Date.now()
  const cached = _userCache.get(userId)
  if (!force && cached && now - cached.ts < CACHE_TTL_MS) return cached.data

  // Evict oldest entry if cache is full, to prevent unbounded growth
  if (_userCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [..._userCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) _userCache.delete(oldest[0])
  }

  const supabase = getSupabase()
  const limite = format(startOfMonth(subMonths(new Date(), 24)), 'yyyy-MM-dd')

  const [r1, r2, r3, r4, r5] = await Promise.all([
    // Transactions (last 24 months)
    supabase
      .from('transacoes_nubank')
      .select('descricao,valor,responsavel,categoria,projeto_fatura,data,cartao,parcela_atual,total_parcelas')
      .gte('projeto_fatura', limite)
      .order('projeto_fatura', { ascending: false }),

    // Planning/budgets
    supabase
      .from('planejamento')
      .select('item,responsavel,valor_previsto,categoria,mes_referencia,parcela_atual,total_parcelas,data_vencimento,data_pagamento')
      .gte('mes_referencia', limite)
      .order('mes_referencia', { ascending: false }),

    // Settings
    supabase.from('configuracoes').select('chave,valor'),

    // Subscriptions
    supabase
      .from('assinaturas')
      .select('nome,valor,cartao,responsavel,categoria,ativa,dia_cobranca')
      .order('valor', { ascending: false }),

    // Investments + contributions
    Promise.all([
      supabase
        .from('investimentos')
        .select('id,descricao,percentual,mes_referencia')
        .order('mes_referencia', { ascending: false }),
      supabase
        .from('investimentos_aportes')
        .select('investimento_id,valor,data_aporte,observacao')
        .order('data_aporte', { ascending: false })
        .limit(100),
    ]),
  ])

  const [invRes, aportesRes] = r5

  const data: EnrichedData = {
    transacoes: (r1.data ?? []) as EnrichedData['transacoes'],
    planejamento: (r2.data ?? []) as EnrichedData['planejamento'],
    configuracoes: (r3.data ?? []) as EnrichedData['configuracoes'],
    assinaturas: (r4.data ?? []) as EnrichedData['assinaturas'],
    investimentos: (invRes.data ?? []) as EnrichedData['investimentos'],
    aportes: (aportesRes.data ?? []) as EnrichedData['aportes'],
    ts: now,
  }

  _userCache.set(userId, { data, ts: now })
  return data
}

// ─── Screen-specific context descriptions ────────────────────────────────────

const SCREEN_CONTEXT: Record<TelaAtual, string> = {
  dashboard: 'TELA ATIVA: Dashboard — visão geral das finanças. Foco em resumo do mês, KPIs principais, comparativo e tendências.',
  compras: 'TELA ATIVA: Compras — análise de transações em cartão. Foco em gastos por categoria, maiores compras, parcelamentos e faturas.',
  financas: 'TELA ATIVA: Finanças — controle de despesas e planejamento. Foco em orçamento previsto vs realizado, despesas em aberto, aderência ao plano.',
  investimentos: 'TELA ATIVA: Investimentos — patrimônio e aportes. Foco em evolução da carteira, rendimentos, aportes recentes e metas.',
  assinaturas: 'TELA ATIVA: Assinaturas — serviços recorrentes. Foco em total mensal, serviços ativos, custo-benefício e otimização.',
  wishlist: 'TELA ATIVA: Wishlist — lista de desejos. Foco em itens desejados, prioridades, valor acumulado e viabilidade financeira.',
  'lista-mercado': 'TELA ATIVA: Lista de Mercado — compras de supermercado. Foco em histórico de gastos, itens frequentes e controle de gastos.',
  extras: 'TELA ATIVA: Extras — despesas eventuais/extras. Foco em gastos não planejados, variância com o orçamento.',
  receitas: 'TELA ATIVA: Receitas — controle de entradas financeiras. Foco em renda mensal, regularidade e fontes de receita.',
  analytics: 'TELA ATIVA: Analytics — análise avançada. Foco em gráficos, tendências históricas, comparativos e insights profundos.',
  geral: 'CONTEXTO: Chat geral — o usuário pode perguntar sobre qualquer aspecto das finanças.',
}

// ─── Intent detection for module-aware context ───────────────────────────────

function detectScreenFromQuestion(pergunta: string): TelaAtual {
  const p = pergunta.toLowerCase()
  if (/assinatura|netflix|spotify|streaming|recorrente/.test(p)) return 'assinaturas'
  if (/invest|aporte|carteira|rendimento|patrimônio|patrimonio/.test(p)) return 'investimentos'
  if (/planejamento|orçamento|orcamento|conta|despesa\s*(fixa|variável|variavel)/.test(p)) return 'financas'
  if (/compra|fatura|cartão|cartao|parcel|transaç/.test(p)) return 'compras'
  if (/mercado|supermercado|lista\s*de/.test(p)) return 'lista-mercado'
  if (/wishlist|desejo|quero\s*comprar|lista\s*de\s*desejos/.test(p)) return 'wishlist'
  if (/receita|renda|salário|salario|entrada/.test(p)) return 'receitas'
  return 'geral'
}

// ─── Format helpers ───────────────────────────────────────────────────────────

const fmtR = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const fmtMes = (mes: string) => {
  try { return format(new Date(mes + '-02'), 'MMM/yyyy', { locale: ptBR }).toUpperCase() }
  catch { return mes }
}

function topCats(lista: Transacao[], n: number): Array<[string, number]> {
  const acc: Record<string, number> = {}
  for (const t of lista) {
    const cat = t.categoria || 'Sem categoria'
    acc[cat] = (acc[cat] ?? 0) + t.valor
  }
  return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, n)
}

// ─── Historical context (tiered detail) ──────────────────────────────────────

function buildHistoricalContext(
  data: EnrichedData,
  mesesFoco: string[]
): string {
  const hoje = new Date()
  const mesAtual = format(hoje, 'yyyy-MM')

  // Use effective month: purchase date for single purchases, fatura for parcels
  const tpm: Record<string, Transacao[]> = {}
  for (const t of data.transacoes) {
    const m = getMesEfetivo(t)
    if (!tpm[m]) tpm[m] = []
    tpm[m].push(t)
  }

  const planPM: Record<string, EnrichedData['planejamento']> = {}
  for (const p of data.planejamento) {
    const m = (p.mes_referencia ?? '').substring(0, 7)
    if (!planPM[m]) planPM[m] = []
    planPM[m].push(p)
  }

  const meses = Object.keys(tpm).sort().reverse()
  if (meses.length === 0) return ''

  const detalhe = new Set([...mesesFoco])
  // Always show current + previous in detail
  detalhe.add(mesAtual)
  detalhe.add(format(subMonths(hoje, 1), 'yyyy-MM'))

  let ctx = ''

  // Detect which cards appear across all transactions (used to decide whether to show card labels)
  const allCards = new Set(data.transacoes.map(t => nomeCartao(t.cartao)))
  const multiCartao = allCards.size > 1

  // Full detail months
  const detailMeses = meses.filter(m => detalhe.has(m) && (tpm[m]?.length ?? 0) > 0)
  if (detailMeses.length > 0) {
    ctx += '\n══ DETALHE MENSAL ══\n'
    for (const m of detailMeses) {
      const lista = tpm[m]
      const total = lista.reduce((a, t) => a + t.valor, 0)
      const mat = lista.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
      const jen = lista.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)
      const plan = planPM[m] ?? []
      const totalPlan = plan.reduce((a, p) => a + p.valor_previsto, 0)

      ctx += `\n▌ ${fmtMes(m)} — ${fmtR(total)} | M: ${fmtR(mat)} | J: ${fmtR(jen)}\n`

      // Per-card breakdown when multiple cards exist
      if (multiCartao) {
        const porCartao: Record<string, number> = {}
        for (const t of lista) {
          const c = nomeCartao(t.cartao)
          porCartao[c] = (porCartao[c] ?? 0) + t.valor
        }
        ctx += `  Por cartão: ${Object.entries(porCartao).map(([c, v]) => `${c} ${fmtR(v)}`).join(' | ')}\n`
      }

      ctx += `  Categorias: ${topCats(lista, 5).map(([c, v]) => `${c} ${fmtR(v)}`).join(' · ')}\n`
      if (totalPlan > 0) {
        const delta = total - totalPlan
        ctx += `  Orçamento: previsto ${fmtR(totalPlan)} | realizado ${fmtR(total)} | delta ${delta >= 0 ? '+' : ''}${fmtR(delta)}\n`
      }
      const top = [...lista].sort((a, b) => b.valor - a.valor).slice(0, 10)
      ctx += `  Maiores compras:\n`
      for (const t of top) {
        const cartaoLabel = multiCartao ? ` [${nomeCartao(t.cartao)}]` : ''
        ctx += `    ${(t.responsavel ?? '?')[0]} ${t.descricao}${cartaoLabel} ${fmtR(t.valor)}${t.categoria ? ` (${t.categoria})` : ''}\n`
      }
    }
  }

  // Months 2-6: summary
  const recentes = meses.filter(m => {
    if (detalhe.has(m)) return false
    const diff = differenceInMonths(new Date(mesAtual + '-01'), new Date(m + '-01'))
    return diff >= 2 && diff <= 6
  })
  if (recentes.length > 0) {
    ctx += '\n══ ÚLTIMOS 6 MESES (resumo) ══\n'
    for (const m of recentes) {
      const lista = tpm[m] ?? []
      if (lista.length === 0) continue
      const total = lista.reduce((a, t) => a + t.valor, 0)
      const cats = topCats(lista, 4).map(([c, v]) => `${c} ${fmtR(v)}`).join(' · ')
      let line = `  ${fmtMes(m)}: ${fmtR(total)} — ${cats}`
      if (multiCartao) {
        const porCartao: Record<string, number> = {}
        for (const t of lista) { const c = nomeCartao(t.cartao); porCartao[c] = (porCartao[c] ?? 0) + t.valor }
        line += ` | cartões: ${Object.entries(porCartao).map(([c, v]) => `${c} ${fmtR(v)}`).join(', ')}`
      }
      ctx += line + '\n'
    }
  }

  // Months 7-12: category only
  const historico = meses.filter(m => {
    if (detalhe.has(m) || recentes.includes(m)) return false
    const diff = differenceInMonths(new Date(mesAtual + '-01'), new Date(m + '-01'))
    return diff >= 7 && diff <= 12
  })
  if (historico.length > 0) {
    ctx += '\n══ 7-12 MESES (totais) ══\n'
    for (const m of historico) {
      const lista = tpm[m] ?? []
      if (lista.length === 0) continue
      const total = lista.reduce((a, t) => a + t.valor, 0)
      const cats = topCats(lista, 3).map(([c, v]) => `${c} ${fmtR(v)}`).join(' · ')
      ctx += `  ${fmtMes(m)}: ${fmtR(total)} — ${cats}\n`
    }
  }

  // Months 13-24: totals only
  const antigos = meses.filter(m => !detalhe.has(m) && !recentes.includes(m) && !historico.includes(m))
  if (antigos.length > 0) {
    ctx += '\n══ 13-24 MESES ══\n'
    for (const m of antigos) {
      const lista = tpm[m] ?? []
      const total = lista.reduce((a, t) => a + t.valor, 0)
      if (total > 0) ctx += `  ${fmtMes(m)}: ${fmtR(total)} (${lista.length} compras)\n`
    }
  }

  return ctx
}

// ─── Category / description focus context ────────────────────────────────────

function buildCategoryFocus(
  data: EnrichedData,
  categorias: string[],
  descricaoFoco: string[],
  responsavelFoco: string | null
): string {
  if (categorias.length === 0 && descricaoFoco.length === 0) return ''

  let ctx = `\n══ ANÁLISE FOCADA ══\n`

  // Build combined search: by category OR by description keyword
  const descLower = descricaoFoco.map(d => d.toLowerCase())

  const allFocused = categorias.length > 0 || descricaoFoco.length > 0
    ? data.transacoes.filter(t => {
        const matchCat = categorias.length > 0 && categorias.includes(t.categoria ?? '')
        const matchDesc = descLower.length > 0 &&
          descLower.some(kw => (t.descricao ?? '').toLowerCase().includes(kw))
        return matchCat || matchDesc
      })
    : []

  if (allFocused.length === 0) {
    ctx += `  Nenhuma transação encontrada para os critérios: ${[...categorias, ...descricaoFoco].join(', ')}\n`
    return ctx
  }

  // Apply responsavel filter if specified, but show full total too
  const filtered = responsavelFoco
    ? allFocused.filter(t => t.responsavel === responsavelFoco)
    : allFocused

  const totalGeral = allFocused.reduce((a, t) => a + t.valor, 0)
  const totalFiltrado = filtered.reduce((a, t) => a + t.valor, 0)

  // Responsavel breakdown
  const porPessoa: Record<string, number> = {}
  for (const t of allFocused) {
    porPessoa[t.responsavel] = (porPessoa[t.responsavel] ?? 0) + t.valor
  }

  const responsavelStr = Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .map(([r, v]) => `${r}: ${fmtR(v)}`)
    .join(' | ')

  // Per-card totals
  const porCartao: Record<string, number> = {}
  for (const t of allFocused) {
    const c = nomeCartao(t.cartao)
    porCartao[c] = (porCartao[c] ?? 0) + t.valor
  }
  const multiCard = Object.keys(porCartao).length > 1
  const cartaoStr = multiCard
    ? ` | cartões: ${Object.entries(porCartao).map(([c, v]) => `${c} ${fmtR(v)}`).join(', ')}`
    : ''

  const label = [...categorias, ...descricaoFoco].join(' + ')
  ctx += `\n${label.toUpperCase()}: ${fmtR(totalGeral)} total histórico\n`
  ctx += `  Por responsável: ${responsavelStr}${cartaoStr}\n`

  if (responsavelFoco && totalFiltrado !== totalGeral) {
    ctx += `  ► Filtrado para ${responsavelFoco}: ${fmtR(totalFiltrado)}\n`
  }

  // Monthly breakdown for focused person (or all if no filter)
  const txForMes = responsavelFoco ? filtered : allFocused
  const porMes = Object.entries(
    txForMes.reduce((acc, t) => {
      const m = getMesEfetivo(t)
      acc[m] = (acc[m] ?? 0) + t.valor
      return acc
    }, {} as Record<string, number>)
  ).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)

  ctx += `  Mensal${responsavelFoco ? ` (${responsavelFoco})` : ''}: ${porMes.map(([m, v]) => `${fmtMes(m)} ${fmtR(v)}`).join(' · ')}\n`

  // Top transactions (focused person or all)
  const topTx = [...txForMes].sort((a, b) => b.valor - a.valor).slice(0, 10)
  ctx += `  Transações${responsavelFoco ? ` (${responsavelFoco})` : ''}:\n`
  for (const t of topTx) {
    const cartaoLabel = multiCard ? ` [${nomeCartao(t.cartao)}]` : ''
    const mesLabel = getMesEfetivo(t)
    ctx += `    ${(t.responsavel ?? '?')[0]} ${t.descricao}${cartaoLabel} — ${fmtR(t.valor)} (${fmtMes(mesLabel)}) [${t.categoria ?? 'sem cat'}]\n`
  }

  return ctx
}

// ─── Intent detection ─────────────────────────────────────────────────────────

type Intent = {
  tipo: 'atual' | 'comparativo' | 'historico' | 'categoria' | 'planejamento' | 'geral'
  mesesFoco: string[]
  categoriasFoco: string[]
  descricaoFoco: string[]   // raw description keywords (e.g. 'uber', 'ifood', 'netflix')
  responsavelFoco: string | null  // 'Matheus' | 'Jeniffer' | null
}

// Maps raw keyword → category.  Also used to extract descricaoFoco.
const CAT_KEYWORD_MAP: Record<string, string[]> = {
  'Alimentação': ['alimenta', 'comida', 'restaurante', 'refeição', 'refeicao', 'ifood', 'delivery', 'padaria', 'lanche'],
  'Mercado': ['mercado', 'supermercado', 'hortifruti', 'açougue', 'acougue'],
  'Saúde': ['saúde', 'saude', 'médico', 'medico', 'farmácia', 'farmacia', 'remédio', 'remedio', 'consulta', 'pilates', 'academia'],
  'Transporte': ['transporte', 'combustível', 'combustivel', 'gasolina', 'uber', 'táxi', 'taxi', 'uberrides'],
  'Entretenimento': ['entretenimento', 'lazer', 'netflix', 'streaming', 'cinema', 'jogo', 'spotify', 'disney', 'hbo'],
  'Educação': ['educação', 'educacao', 'escola', 'faculdade', 'curso', 'livro'],
  'Moradia': ['aluguel', 'condomínio', 'condominio', 'energia', 'internet', 'casa', 'água', 'agua', 'luz'],
  'Vestuário': ['roupa', 'vestuário', 'vestuario', 'calçado', 'calcado', 'moda', 'sapato'],
  'Tecnologia': ['tecnologia', 'celular', 'computador', 'eletrônico', 'eletronico', 'apple', 'samsung'],
  'Viagem': ['viagem', 'hotel', 'passagem', 'aéreo', 'aereo', 'turismo', 'airbnb'],
}

// Direct description keywords that should trigger a description-level search
const DESCRICAO_KEYWORDS = [
  'uber', 'ifood', 'rappi', 'netflix', 'spotify', 'amazon', 'mercado livre',
  'shopee', 'shein', 'americanas', 'magazine', 'casas bahia', 'ponto frio',
  'nubank', 'picpay', 'pagbank', 'itau', 'bradesco', 'santander',
  'pilates', 'academia', 'gym', 'sephora', 'renner', 'riachuelo',
  'postos', 'shell', 'petrobras', 'posto', 'gasolina',
]

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

  const categoriasFoco: string[] = []
  for (const [cat, kws] of Object.entries(CAT_KEYWORD_MAP)) {
    if (kws.some(kw => p.includes(kw))) categoriasFoco.push(cat)
  }

  // Extract specific description keywords mentioned in the query
  const descricaoFoco = DESCRICAO_KEYWORDS.filter(kw => p.includes(kw))

  // Detect responsavel filter (Matheus or Jeniffer)
  let responsavelFoco: string | null = null
  if (/\bjeniffer\b/.test(p)) responsavelFoco = 'Jeniffer'
  else if (/\bmatheus\b/.test(p)) responsavelFoco = 'Matheus'

  let tipo: Intent['tipo'] = 'atual'
  if (/planejamento|orçamento|orcamento|previsto|budget/.test(p)) tipo = 'planejamento'
  else if (/compar|versus|evolução|evolu|tendência|tendencia|variação|varia/.test(p)) tipo = 'comparativo'
  else if (/histórico|historico|média\s*mensal|todos\s*os\s*meses/.test(p)) tipo = 'historico'
  else if ((categoriasFoco.length > 0 || descricaoFoco.length > 0) && mesesFoco.length === 0) tipo = 'categoria'
  else if (mesesFoco.length > 0 && !mesesFoco.includes(mesAtual)) tipo = 'historico'

  return { tipo, mesesFoco, categoriasFoco, descricaoFoco, responsavelFoco }
}

