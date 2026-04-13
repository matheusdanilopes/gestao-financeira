import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CATEGORIAS = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet', 'Outros',
]

const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
}

export async function POST(_req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const supabase = getSupabase()
    const { data: transacoes, error } = await supabase
      .from('transacoes_nubank')
      .select('hash_linha, descricao')
      .is('categoria', null)
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ categorized: 0, message: 'Nenhuma transação pendente' })
    }

    const lista = transacoes.map((t: any, i: number) => `${i + 1}. ${t.descricao}`).join('\n')
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
    if (!texto) return NextResponse.json({ error: 'Resposta inválida da IA' }, { status: 500 })

    const { categorias } = JSON.parse(texto)
    if (!Array.isArray(categorias) || categorias.length !== transacoes.length) {
      return NextResponse.json({ error: 'Número de categorias não bate' }, { status: 500 })
    }

    for (let i = 0; i < transacoes.length; i++) {
      const categoria = CATEGORIAS.includes(categorias[i]) ? categorias[i] : 'Outros'
      await supabase
        .from('transacoes_nubank')
        .update({ categoria })
        .eq('hash_linha', (transacoes[i] as any).hash_linha)
    }

    return NextResponse.json({ categorized: transacoes.length })
  } catch (error) {
    console.error('[categorizar]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
