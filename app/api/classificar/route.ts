import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'
import {
  sanitizarDescricao,
  buscarContextoRAG,
  classificarComGemini,
  CONFIANCA_VALIDADO,
} from '@/lib/ragClassificacao'

export const maxDuration = 300

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface ClassificarBody {
  hash_linhas?: string[]
  somenteSemCategoria?: boolean
}

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  let body: ClassificarBody = {}
  try {
    body = await req.json()
  } catch {
    // empty body is valid — classifies all eligible transactions
  }

  // user_id comes from the session, not the request body
  const user_id = user.id

  const { hash_linhas, somenteSemCategoria = false } = body

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
    query = query.or('categoria.is.null,categoria_origem.eq.IA,categoria_origem.eq.RAG')
  }

  if (hash_linhas && Array.isArray(hash_linhas) && hash_linhas.length > 0) {
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
          categoria_confianca: resultado.confianca / 100,
          classificacao_status: classificacaoStatus,
        })
        .eq('hash_linha', t.hash_linha)

      if (classificacaoStatus === 'validado') {
        classificados++
      } else {
        revisao_pendente++
      }

      if (i < transacoes.length - 1) {
        await sleep(300)
      }
    } catch (err) {
      const msg = `[${t.hash_linha.slice(0, 8)}] ${err instanceof Error ? err.message : 'unknown'}`
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
