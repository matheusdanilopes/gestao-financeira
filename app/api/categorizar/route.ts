import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'

const CATEGORIAS = [
  'Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer',
  'Educação', 'Moradia', 'Vestuário', 'Tecnologia', 'Serviços', 'Viagem', 'Pet', 'Outros',
]

function getClients() {
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '', {
    apiVersion: 'v1',
  } as any)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
  )
  return { genai, supabase }
}

export async function POST(_req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
    }

    const { genai, supabase } = getClients()

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

    const model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const result = await model.generateContent(
      `Categorize cada transação abaixo com UMA das categorias: ${CATEGORIAS.join(', ')}.

Transações:
${lista}

Responda APENAS com JSON no formato:
{"categorias": ["Categoria1", "Categoria2", ...]}

A lista deve ter exatamente ${transacoes.length} categorias, na mesma ordem das transações.`
    )

    const texto = result.response.text()
    const jsonMatch = texto.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Resposta inválida da IA' }, { status: 500 })

    const { categorias } = JSON.parse(jsonMatch[0])
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
