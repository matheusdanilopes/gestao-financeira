import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { sanitizarDescricao, atualizarAprendizado } from '@/lib/ragClassificacao'

interface FeedbackBody {
  hash_linha: string
  categoria_validada: string
}

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: FeedbackBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  const { hash_linha, categoria_validada } = body
  // user_id always comes from the authenticated session
  const user_id = user.id

  if (!hash_linha || !categoria_validada) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: hash_linha, categoria_validada' },
      { status: 400 }
    )
  }

  const { data: transacao, error: tErr } = await supabase
    .from('transacoes_nubank')
    .select('descricao')
    .eq('hash_linha', hash_linha)
    .maybeSingle()

  if (tErr || !transacao) {
    return NextResponse.json({ error: 'Transação não encontrada.' }, { status: 404 })
  }

  const descricaoLimpa = sanitizarDescricao(transacao.descricao)

  await atualizarAprendizado(supabase, descricaoLimpa, categoria_validada, user_id)

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
