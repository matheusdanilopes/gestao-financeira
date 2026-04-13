import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const GEMINI_MODEL = 'gemini-3-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

async function geminiChat(apiKey: string, systemPrompt: string, mensagens: Array<{ role: string; content: string }>) {
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Entendido! Estou pronto para responder suas perguntas sobre as finanças do casal.' }] },
    ...mensagens.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ]

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

async function buscarContextoFinanceiro(): Promise<string> {
  const supabase = getSupabase()
  const hoje = new Date()
  const mesAtual = startOfMonth(hoje)
  const mesAnterior = startOfMonth(subMonths(hoje, 1))
  const mesRef = format(mesAtual, 'yyyy-MM-dd')
  const mesRefAnterior = format(mesAnterior, 'yyyy-MM-dd')
  const nomeMes = format(mesAtual, 'MMMM yyyy', { locale: ptBR })
  const nomeMesAnterior = format(mesAnterior, 'MMMM yyyy', { locale: ptBR })

  const [resAtual, resAnterior, resPlan] = await Promise.all([
    supabase.from('transacoes_nubank').select('descricao, valor, responsavel, categoria').eq('projeto_fatura', mesRef),
    supabase.from('transacoes_nubank').select('valor, responsavel').eq('projeto_fatura', mesRefAnterior),
    supabase.from('planejamento').select('item, valor_previsto').eq('mes_referencia', mesRef),
  ])

  const transacoesAtual = (resAtual.data ?? []) as Array<{ descricao: string; valor: number; responsavel: string; categoria: string | null }>
  const transacoesAnterior = (resAnterior.data ?? []) as Array<{ valor: number; responsavel: string }>
  const planejamento = (resPlan.data ?? []) as Array<{ item: string; valor_previsto: number }>

  const totalAtual = transacoesAtual.reduce((a, t) => a + t.valor, 0)
  const totalAnterior = transacoesAnterior.reduce((a, t) => a + t.valor, 0)
  const matheusAtual = transacoesAtual.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const jenifferAtual = transacoesAtual.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)
  const receitaTotal = planejamento.find(p => p.item === 'Receita Total')?.valor_previsto ?? 0
  const matheusPrevisto = planejamento.find(p => p.item === 'NuBank Matheus')?.valor_previsto ?? 0
  const jenifferPrevisto =
    (planejamento.find(p => p.item === 'NuBank Jeniffer')?.valor_previsto ?? 0) +
    (planejamento.find(p => p.item === 'NuBank Jeniffer Conjunto')?.valor_previsto ?? 0)

  const porCategoria: Record<string, number> = {}
  for (const t of transacoesAtual) {
    const cat = t.categoria || 'Sem categoria'
    porCategoria[cat] = (porCategoria[cat] ?? 0) + t.valor
  }
  const categoriasStr = Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => `  - ${cat}: R$ ${val.toFixed(2)}`)
    .join('\n')

  const top5 = [...transacoesAtual]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5)
    .map(t => `  - ${t.descricao} (${t.responsavel}): R$ ${t.valor.toFixed(2)}`)
    .join('\n')

  return `
DADOS FINANCEIROS — ${nomeMes.toUpperCase()}

Receita total prevista: R$ ${receitaTotal.toFixed(2)}
Gasto total no cartão: R$ ${totalAtual.toFixed(2)}
Sobra estimada: R$ ${(receitaTotal - totalAtual).toFixed(2)}
Comprometimento: ${receitaTotal > 0 ? ((totalAtual / receitaTotal) * 100).toFixed(1) : 0}%

NUBANK POR PESSOA:
- Matheus: R$ ${matheusAtual.toFixed(2)} (previsto R$ ${matheusPrevisto.toFixed(2)})
- Jeniffer: R$ ${jenifferAtual.toFixed(2)} (previsto R$ ${jenifferPrevisto.toFixed(2)})

GASTOS POR CATEGORIA:
${categoriasStr || '  (sem categorias ainda)'}

TOP 5 MAIORES COMPRAS:
${top5 || '  (sem compras)'}

MÊS ANTERIOR (${nomeMesAnterior}):
- Total gasto: R$ ${totalAnterior.toFixed(2)}
- Variação: ${totalAnterior > 0 ? ((totalAtual - totalAnterior) / totalAnterior * 100).toFixed(1) : 'N/A'}%

Total de transações no mês: ${transacoesAtual.length}
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
Use os dados financeiros abaixo para responder perguntas sobre gastos, orçamento e finanças.
Formate valores monetários sempre como R$ X.XX.

${contexto}`

    const texto = await geminiChat(apiKey, systemPrompt, mensagens)
    return NextResponse.json({ resposta: texto })
  } catch (error) {
    console.error('[chat]', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
