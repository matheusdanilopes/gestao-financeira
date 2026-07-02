import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

interface ResolverBody {
  notificacao_id: string
  acao: 'aprovar' | 'recusar' | 'desfazer'
}

interface ConflictMetadata {
  original_id: string
  conflito_id: string
  valor_original: number
  valor_novo: number
  descricao: string
  data_compra: string
  resolucao?: 'aprovar' | 'recusar'
  original_antes?: { status: string; valor: number; valor_final: number | null }
  conflito_snapshot?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const { supabase, user, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: ResolverBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  const { notificacao_id, acao } = body
  if (!notificacao_id || !['aprovar', 'recusar', 'desfazer'].includes(acao)) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: notificacao_id e acao ("aprovar" | "recusar" | "desfazer").' },
      { status: 400 }
    )
  }

  // Carrega a notificação para obter o metadata do conflito
  const { data: notif, error: notifErr } = await supabase
    .from('notificacoes')
    .select('id, acao, metadata, lida')
    .eq('id', notificacao_id)
    .single()

  if (notifErr || !notif) {
    return NextResponse.json({ error: 'Notificação não encontrada.' }, { status: 404 })
  }
  if (notif.acao !== 'conciliacao_conflito') {
    return NextResponse.json({ error: 'Notificação não é um conflito de conciliação.' }, { status: 422 })
  }
  if (acao !== 'desfazer' && notif.lida) {
    return NextResponse.json({ error: 'Conflito já foi resolvido.' }, { status: 409 })
  }
  if (acao === 'desfazer' && !notif.lida) {
    return NextResponse.json({ error: 'Conflito ainda não foi resolvido.' }, { status: 409 })
  }

  const meta = notif.metadata as ConflictMetadata
  const { original_id, conflito_id, valor_novo } = meta

  if (!original_id || !conflito_id) {
    return NextResponse.json({ error: 'Metadata inválida.' }, { status: 422 })
  }

  if (acao === 'aprovar') {
    const { data: originalAntes } = await supabase
      .from('transacoes_nubank').select('*').eq('id', original_id).single()
    const { data: conflitoAntes } = await supabase
      .from('transacoes_nubank').select('*').eq('id', conflito_id).single()

    if (!originalAntes || !conflitoAntes) {
      return NextResponse.json({ error: 'Registro original ou de conflito não encontrado.' }, { status: 404 })
    }

    // Compare-and-swap: só aplica se o original ainda não foi mexido por outro fluxo
    const { data: atualizado, error: updErr } = await supabase
      .from('transacoes_nubank')
      .update({ valor: valor_novo, valor_final: valor_novo, status: 'CONCILIADO' })
      .eq('id', original_id).eq('status', originalAntes.status)
      .select('id')

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao atualizar registro original: ' + updErr.message }, { status: 500 })
    }
    if (!atualizado?.length) {
      return NextResponse.json({ error: 'Não foi possível atualizar o registro original (pode ter sido alterado por outro fluxo).' }, { status: 409 })
    }

    // Guarda o snapshot completo do conflito no metadata antes de remover, para permitir desfazer depois
    await supabase.from('transacoes_nubank').delete().eq('id', conflito_id)

    await supabase.from('notificacoes').update({
      lida: true,
      resolvido_em: new Date().toISOString(),
      resolvido_por: user?.email ?? null,
      metadata: {
        ...meta,
        resolucao: 'aprovar',
        original_antes: { status: originalAntes.status, valor: originalAntes.valor, valor_final: originalAntes.valor_final },
        conflito_snapshot: conflitoAntes,
      },
    }).eq('id', notificacao_id)

    return NextResponse.json({ success: true, acao })
  }

  if (acao === 'recusar') {
    // Recusa: converte o conflito em uma compra nova (PENDENTE)
    const { data: atualizado, error: updErr } = await supabase
      .from('transacoes_nubank')
      .update({ status: 'PENDENTE', conciliacao_ref: null })
      .eq('id', conflito_id).eq('status', 'CONFLITO_VALOR')
      .select('id')

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao converter conflito em compra: ' + updErr.message }, { status: 500 })
    }
    if (!atualizado?.length) {
      return NextResponse.json({ error: 'Não foi possível converter o conflito (pode ter sido alterado por outro fluxo).' }, { status: 409 })
    }

    await supabase.from('notificacoes').update({
      lida: true,
      resolvido_em: new Date().toISOString(),
      resolvido_por: user?.email ?? null,
      metadata: { ...meta, resolucao: 'recusar' },
    }).eq('id', notificacao_id)

    return NextResponse.json({ success: true, acao })
  }

  // acao === 'desfazer'
  if (!meta.resolucao) {
    return NextResponse.json({ error: 'Notificação não possui uma decisão para desfazer.' }, { status: 422 })
  }

  if (meta.resolucao === 'aprovar') {
    if (!meta.original_antes || !meta.conflito_snapshot) {
      return NextResponse.json({ error: 'Dados insuficientes para desfazer esta aprovação.' }, { status: 422 })
    }

    const { data: restaurado, error: e1 } = await supabase
      .from('transacoes_nubank')
      .update({
        status: meta.original_antes.status,
        valor: meta.original_antes.valor,
        valor_final: meta.original_antes.valor_final,
      })
      .eq('id', original_id).eq('status', 'CONCILIADO')
      .select('id')

    if (e1) {
      return NextResponse.json({ error: 'Erro ao restaurar registro original: ' + e1.message }, { status: 500 })
    }
    if (!restaurado?.length) {
      return NextResponse.json({ error: 'Registro original mudou desde a aprovação; não é seguro desfazer.' }, { status: 409 })
    }

    const { error: e2 } = await supabase.from('transacoes_nubank').insert(meta.conflito_snapshot)
    if (e2) {
      return NextResponse.json({ error: 'Erro ao restaurar o registro de conflito: ' + e2.message }, { status: 500 })
    }
  } else {
    // 'recusar': o conflito virou PENDENTE/conciliacao_ref=null — devolve ao estado CONFLITO_VALOR
    const { data: restaurado, error: e1 } = await supabase
      .from('transacoes_nubank')
      .update({ status: 'CONFLITO_VALOR', conciliacao_ref: original_id })
      .eq('id', conflito_id).eq('status', 'PENDENTE')
      .select('id')

    if (e1) {
      return NextResponse.json({ error: 'Erro ao restaurar registro de conflito: ' + e1.message }, { status: 500 })
    }
    if (!restaurado?.length) {
      return NextResponse.json({ error: 'Registro mudou desde a recusa; não é seguro desfazer.' }, { status: 409 })
    }
  }

  // Reabre a notificação para permitir uma nova decisão
  const { resolucao: _r, original_antes: _oa, conflito_snapshot: _cs, ...metaBase } = meta
  await supabase.from('notificacoes').update({
    lida: false,
    resolvido_em: null,
    resolvido_por: null,
    metadata: metaBase,
  }).eq('id', notificacao_id)

  return NextResponse.json({ success: true, acao: 'desfazer' })
}
