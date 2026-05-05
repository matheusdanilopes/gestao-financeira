import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'
import {
  sanitizarDescricao,
  buscarContextoRAG,
  classificarComGemini,
  CONFIANCA_VALIDADO,
} from '@/lib/ragClassificacao'

export const maxDuration = 300

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      'placeholder'
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface ClassificarBody {
  hash_linhas?: string[]
  somenteSemCategoria?: boolean
  user_id?: string
}

// POST /api/classificar
//
// Classifica transações usando um pipeline RAG:
//   1. Sanitiza a descrição da transação
//   2. Busca o histórico de classificações similares (Supabase)
//   3. Envia um prompt enriquecido ao Gemini 1.5 Flash
//   4. Persiste o resultado com classificacao_status:
//        "validado"        → confiança >= 90
//        "revisao_pendente" → confiança <  90
//
// Body (opcional):
//   hash_linhas       — restringe às transações com esses hashes
//   somenteSemCategoria — quando true, ignora transações já categorizadas por humano
//   user_id           — identifica o usuário no histórico de aprendizado (default: "default")
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  const supabase = getSupabase()

  let body: ClassificarBody = {}
  try {
    body = await req.json()
  } catch {
    // empty body is valid — classifies all eligible transactions
  }

  const { hash_linhas, somenteSemCategoria = false, user_id = 'default' } = body

  const { data: configRow } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'categorias_compras')
    .maybeSingle()
  const categoriasPermitidas = parseCategoriasConfig(configRow?.valor) || CATEGORIAS_PADRAO

  let query = supabase.from('transacoes_nubank').select('hash_linha, descricao')

  if (somenteSemCategoria) {
    query = query.is('categoria', null)
  } else {
    // Recategorize nulls and existing AI/RAG categories (not user-validated ones)
    query = query.or('categoria.is.null,categoria_origem.eq.IA,categoria_origem.eq.RAG')
  }

  if (hash_linhas && hash_linhas.length > 0) {
    query = query.in('hash_linha', hash_linhas)
  }

  const { data: transacoes, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!transacoes || transacoes.length === 0) {
    return NextResponse.json({ classificados: 0, revisao_pendente: 0, total: 0 })
  }

  let classificados = 0
  let revisao_pendente = 0
  const erros: string[] = []

  for (let i = 0; i < transacoes.length; i++) {
    const t = transacoes[i]
    try {
      const descricaoLimpa = sanitizarDescricao(t.descricao)
      const contexto = await buscarContextoRAG(supabase, descricaoLimpa, user_id)

      const resultado = await classificarComGemini(
        t.descricao,
        descricaoLimpa,
        contexto,
        apiKey,
        categoriasPermitidas
      )

      const classificacaoStatus =
        resultado.confianca >= CONFIANCA_VALIDADO ? 'validado' : 'revisao_pendente'

      await supabase
        .from('transacoes_nubank')
        .update({
          categoria: resultado.categoria,
          categoria_origem: 'RAG',
          // DB stores confidence as 0.00–1.00 (NUMERIC(3,2))
          categoria_confianca: resultado.confianca / 100,
          classificacao_status: classificacaoStatus,
        })
        .eq('hash_linha', t.hash_linha)

      if (classificacaoStatus === 'validado') {
        classificados++
      } else {
        revisao_pendente++
      }

      // Small delay between requests to respect Gemini rate limits
      if (i < transacoes.length - 1) {
        await sleep(300)
      }
    } catch (err) {
      const msg = `[${t.hash_linha.slice(0, 8)}] ${String(err)}`
      console.error('[classificar-rag]', msg)
      erros.push(msg)
    }
  }

  return NextResponse.json({
    classificados,
    revisao_pendente,
    total: transacoes.length,
    erros: erros.length > 0 ? erros : undefined,
  })
}
