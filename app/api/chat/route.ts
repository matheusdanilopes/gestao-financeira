import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

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
    { role: 'model', parts: [{ text: 'Entendido! Estou pronto para responder suas perguntas sobre as finanças do casal.' }] },
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

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const { mensagens } = await req.json()
    const contexto = await buscarContextoFinanceiro()

    const systemPrompt = `Você é um assistente financeiro pessoal do casal Matheus e Jeniffer.
Responda sempre em português brasileiro, de forma clara, objetiva e amigável.
Use os dados financeiros abaixo para responder perguntas sobre gastos, orçamento, tendências e finanças em geral.
Formate valores monetários sempre como R$ X.XX.
Quando comparar períodos, use os dados históricos disponíveis.
IMPORTANTE: Nunca corte ou trunce suas respostas. Sempre conclua completamente o que começou a escrever.

${contexto}`

    const texto = await geminiChat(apiKey, systemPrompt, mensagens)
    return NextResponse.json({ resposta: texto })
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
