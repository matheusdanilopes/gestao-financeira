import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sanitizarDescricao, atualizarAprendizado } from '@/lib/ragClassificacao'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      'placeholder'
  )
}

interface FeedbackBody {
  hash_linha: string
  categoria_validada: string
  user_id?: string
}

// POST /api/classificar/feedback
//
// Registra a confirmação ou correção de categoria pelo usuário (Active Learning).
// Esse endpoint deve ser chamado sempre que o usuário:
//   - Confirmar a categoria sugerida pela IA
//   - Corrigir a categoria para outra opção
//
// Efeitos:
//   1. Incrementa (ou cria) o registro em classificacoes_aprendidas para a
//      descrição sanitizada, reforçando a memória de longo prazo.
//   2. Atualiza a transação: categoria_validada pelo usuário + categoria_origem
//      = 'USUARIO' + classificacao_status = 'validado'.
//
// Body:
//   hash_linha        — identificador único da transação
//   categoria_validada — categoria confirmada ou corrigida pelo usuário
//   user_id           — identifica o usuário no histórico (default: "default")
export async function POST(req: NextRequest) {
  let body: FeedbackBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  const { hash_linha, categoria_validada, user_id = 'default' } = body

  if (!hash_linha || !categoria_validada) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: hash_linha, categoria_validada' },
      { status: 400 }
    )
  }

  const supabase = getSupabase()

  // Load transaction to get the original description for sanitization
  const { data: transacao, error: tErr } = await supabase
    .from('transacoes_nubank')
    .select('descricao')
    .eq('hash_linha', hash_linha)
    .maybeSingle()

  if (tErr || !transacao) {
    return NextResponse.json({ error: 'Transação não encontrada.' }, { status: 404 })
  }

  const descricaoLimpa = sanitizarDescricao(transacao.descricao)

  // Update long-term memory: upsert with frequency increment
  await atualizarAprendizado(supabase, descricaoLimpa, categoria_validada, user_id)

  // Mark the transaction as user-validated
  const { error: updErr } = await supabase
    .from('transacoes_nubank')
    .update({
      categoria: categoria_validada,
      categoria_origem: 'USUARIO',
      categoria_confianca: 1.0,
      classificacao_status: 'validado',
    })
    .eq('hash_linha', hash_linha)

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    descricao_limpa: descricaoLimpa,
    categoria_validada,
  })
}
