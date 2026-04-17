import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CATEGORIAS = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet', 'Outros',
]

const BATCH_SIZE = 50
const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

async function categorizarLote(
  apiKey: string,
  transacoes: { hash_linha: string; descricao: string }[]
): Promise<string[]> {
  const lista = transacoes.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n')
  const prompt = `Categorize cada transação abaixo com UMA das categorias: ${CATEGORIAS.join(', ')}.

Transações:
${lista}

Retorne um JSON no formato: {"categorias": ["Categoria1", "Categoria2", ...]}
A lista deve ter exatamente ${transacoes.length} categorias, na mesma ordem das transações.`

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }

  const data = await res.json()
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!texto) throw new Error('Resposta inválida da IA')

  const { categorias } = JSON.parse(texto)
  if (!Array.isArray(categorias) || categorias.length !== transacoes.length) {
    throw new Error('Número de categorias não bate')
  }

  return categorias
}

export async function POST(_req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const supabase = getSupabase()
    let totalCategorizado = 0

    while (true) {
      const { data: transacoes, error } = await supabase
        .from('transacoes_nubank')
        .select('hash_linha, descricao')
        .is('categoria', null)
        .limit(BATCH_SIZE)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!transacoes || transacoes.length === 0) break

      const categorias = await categorizarLote(apiKey, transacoes)

      await Promise.all(
        transacoes.map((t, i) => {
          const categoria = CATEGORIAS.includes(categorias[i]) ? categorias[i] : 'Outros'
          return supabase
            .from('transacoes_nubank')
            .update({ categoria })
            .eq('hash_linha', t.hash_linha)
        })
      )

      totalCategorizado += transacoes.length

      // lote menor que o máximo significa que não há mais pendentes
      if (transacoes.length < BATCH_SIZE) break
    }

    return NextResponse.json({
      categorized: totalCategorizado,
      message: totalCategorizado === 0 ? 'Nenhuma transação pendente' : undefined,
    })
  } catch (error) {
    console.error('[categorizar]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
