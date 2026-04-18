import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CATEGORIAS = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet', 'Outros',
]

const LOTE = 50
const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

async function categorizarLote(
  transacoes: { hash_linha: string; descricao: string }[],
  apiKey: string
): Promise<string[]> {
  const lista = transacoes.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n')

  const prompt = `Categorize cada transação abaixo com UMA das categorias: ${CATEGORIAS.join(', ')}.

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
    throw new Error(`Gemini erro ${res.status}: ${await res.text()}`)
  }

  const data = await res.json()
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!texto) throw new Error('Resposta vazia da IA')

  const { categorias } = JSON.parse(texto)
  if (!Array.isArray(categorias) || categorias.length !== transacoes.length) {
    throw new Error(`Número de categorias retornado (${categorias?.length}) diferente do esperado (${transacoes.length})`)
  }

  return categorias.map((c: string) => (CATEGORIAS.includes(c) ? c : 'Outros'))
}

export async function POST(_req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const supabase = getSupabase()

    // Busca TODAS as transações, sem filtro de categoria
    const { data: transacoes, error } = await supabase
      .from('transacoes_nubank')
      .select('hash_linha, descricao')
      .order('data', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ categorized: 0, message: 'Nenhuma transação encontrada' })
    }

    // Divide em lotes e processa cada um
    let totalCategorized = 0
    const erros: string[] = []

    for (let i = 0; i < transacoes.length; i += LOTE) {
      const lote = transacoes.slice(i, i + LOTE)

      try {
        const categorias = await categorizarLote(lote, apiKey)

        await Promise.all(
          lote.map((t, j) =>
            supabase
              .from('transacoes_nubank')
              .update({ categoria: categorias[j] })
              .eq('hash_linha', t.hash_linha)
          )
        )

        totalCategorized += lote.length
      } catch (err) {
        const msg = `Lote ${Math.floor(i / LOTE) + 1}: ${String(err)}`
        console.error('[categorizar]', msg)
        erros.push(msg)
      }
    }

    return NextResponse.json({
      categorized: totalCategorized,
      total: transacoes.length,
      erros: erros.length > 0 ? erros : undefined,
    })
  } catch (error) {
    console.error('[categorizar]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
