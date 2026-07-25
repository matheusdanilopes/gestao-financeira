import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { inserirRegistro } from '@/lib/conciliacao'
import { criarSupabaseServer } from '@/lib/supabaseServer'

type Decisao =
  | 'inserida' | 'removida' | 'duplicada' | 'conflito'
  | 'conciliada' | 'conciliacao_desfeita'
  | 'estorno_aplicado' | 'estorno_registrado' | 'estorno_removido' | 'estorno_ignorado'

type AcaoPedida = 'reverter' | 'reaplicar'

interface EstadoAnteriorEstorno {
  original_id: string
  status_anterior: string | null
}

interface EstadoAnteriorConciliacao {
  status: string
  valor: number
  valor_final: number | null
}

interface LinhaValidacaoRow {
  id: string
  log_id: string
  descricao: string
  valor: number | null
  data_compra: string | null
  decisao: Decisao
  transacao_id: string | null
  dados_linha: Record<string, unknown>
  estado_anterior: Record<string, unknown> | null
  notificacao_id: string | null
  revertido_em: string | null
  created_at: string
}

const DOIS_DIAS_MS = 2 * 24 * 60 * 60 * 1000

async function registrarLogServidor(
  supabase: ReturnType<typeof criarSupabaseServer>,
  acao: 'inserir' | 'excluir' | 'editar',
  descricao: string,
  valor: number | null
) {
  try {
    await supabase.from('activity_logs').insert({
      acao,
      tabela: 'transacoes_nubank',
      descricao,
      valor: valor ?? null,
    })
  } catch { /* falha no log nunca deve interromper a resposta */ }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linhaId: string }> }
) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized
  const { id: logId, linhaId } = await params

  let body: { acao?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido: esperado JSON com { acao }.' }, { status: 400 })
  }

  if (body.acao !== 'reverter' && body.acao !== 'reaplicar') {
    return NextResponse.json({ error: 'Campo "acao" deve ser "reverter" ou "reaplicar".' }, { status: 400 })
  }
  const acaoPedida = body.acao as AcaoPedida

  const { data: linhaRaw, error: erroLinha } = await supabase
    .from('import_validacoes')
    .select('*')
    .eq('id', linhaId)
    .eq('log_id', logId)
    .maybeSingle()

  if (erroLinha) return NextResponse.json({ error: erroLinha.message }, { status: 500 })
  if (!linhaRaw) return NextResponse.json({ error: 'Linha de validação não encontrada.' }, { status: 404 })
  const linha = linhaRaw as LinhaValidacaoRow

  if (Date.now() - new Date(linha.created_at).getTime() > DOIS_DIAS_MS) {
    return NextResponse.json(
      { error: 'Este registro passou da janela de retenção de 2 dias e não pode mais ser alterado.' },
      { status: 410 }
    )
  }

  async function atualizarLinha(
    supabaseCliente: ReturnType<typeof criarSupabaseServer>,
    patch: Partial<Pick<LinhaValidacaoRow, 'decisao' | 'transacao_id'>>
  ) {
    const { data, error } = await supabaseCliente
      .from('import_validacoes')
      .update({ ...patch, revertido_em: new Date().toISOString() })
      .eq('id', linhaId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  try {
    // --- inserida -> removida (excluir a transação inserida pela importação) ---
    if (linha.decisao === 'inserida' && acaoPedida === 'reverter') {
      if (!linha.transacao_id) {
        return NextResponse.json({ error: 'Nenhuma transação associada a esta linha.' }, { status: 409 })
      }
      const { data: deletados, error } = await supabase
        .from('transacoes_nubank')
        .delete()
        .eq('id', linha.transacao_id)
        .eq('status', 'PENDENTE')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!deletados || deletados.length === 0) {
        return NextResponse.json({ error: 'A transação já foi alterada desde a importação — não é possível remover automaticamente.' }, { status: 409 })
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'removida', transacao_id: null })
      await registrarLogServidor(supabase, 'excluir', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- removida -> inserida (reinserir a transação) ---
    if (linha.decisao === 'removida' && acaoPedida === 'reaplicar') {
      const { id: novoId, ok } = await inserirRegistro(supabase, { ...linha.dados_linha, status: 'PENDENTE' })
      if (!ok) {
        return NextResponse.json({ error: 'Já existe uma transação com os mesmos dados (provavelmente reimportada depois). Não é possível reinserir.' }, { status: 409 })
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'inserida', transacao_id: novoId })
      await registrarLogServidor(supabase, 'inserir', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- duplicada -> inserida (forçar inserção mesmo já havendo um match/hash duplicado) ---
    if (linha.decisao === 'duplicada' && acaoPedida === 'reaplicar') {
      const { id: novoId, ok } = await inserirRegistro(supabase, { ...linha.dados_linha, status: 'PENDENTE' })
      if (!ok) {
        return NextResponse.json({ error: 'Já existe uma transação com o mesmo hash (reimportação exata da mesma linha) — não é possível inserir de novo.' }, { status: 409 })
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'inserida', transacao_id: novoId })
      await registrarLogServidor(supabase, 'inserir', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- conciliada -> conciliacao_desfeita (restaura status/valor_final da transação pendente original) ---
    if (linha.decisao === 'conciliada' && acaoPedida === 'reverter') {
      const estadoAnterior = linha.estado_anterior as EstadoAnteriorConciliacao | null
      if (!linha.transacao_id || !estadoAnterior) {
        return NextResponse.json({ error: 'Não há estado anterior registrado para desfazer esta conciliação.' }, { status: 409 })
      }
      const { data: restaurado, error } = await supabase
        .from('transacoes_nubank')
        .update({ status: estadoAnterior.status, valor_final: estadoAnterior.valor_final })
        .eq('id', linha.transacao_id)
        .eq('status', 'CONCILIADO')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!restaurado || restaurado.length === 0) {
        return NextResponse.json({ error: 'A transação já foi alterada desde a importação — não é possível desfazer automaticamente.' }, { status: 409 })
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'conciliacao_desfeita', transacao_id: linha.transacao_id })
      await registrarLogServidor(supabase, 'editar', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- conciliacao_desfeita -> conciliada (reaplica a conciliação) ---
    if (linha.decisao === 'conciliacao_desfeita' && acaoPedida === 'reaplicar') {
      const estadoAnterior = linha.estado_anterior as EstadoAnteriorConciliacao | null
      if (!linha.transacao_id) {
        return NextResponse.json({ error: 'Nenhuma transação associada a esta linha.' }, { status: 409 })
      }
      const valorConciliado = (linha.dados_linha as { valor?: number }).valor ?? linha.valor ?? 0
      const { data: reconciliado, error } = await supabase
        .from('transacoes_nubank')
        .update({ status: 'CONCILIADO', valor_final: valorConciliado })
        .eq('id', linha.transacao_id)
        .eq('status', estadoAnterior?.status ?? 'PENDENTE')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!reconciliado || reconciliado.length === 0) {
        return NextResponse.json({ error: 'A transação já foi alterada desde então — não é possível reaplicar automaticamente.' }, { status: 409 })
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'conciliada', transacao_id: linha.transacao_id })
      await registrarLogServidor(supabase, 'editar', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- estorno_aplicado/estorno_registrado -> estorno_removido (excluir o registro de estorno) ---
    if ((linha.decisao === 'estorno_aplicado' || linha.decisao === 'estorno_registrado') && acaoPedida === 'reverter') {
      if (!linha.transacao_id) {
        return NextResponse.json({ error: 'Nenhum registro de estorno associado a esta linha.' }, { status: 409 })
      }
      const estadoAnterior = linha.estado_anterior as EstadoAnteriorEstorno | null
      const { data: deletados, error } = await supabase
        .from('transacoes_nubank')
        .delete()
        .eq('id', linha.transacao_id)
        .eq('status', 'ESTORNO')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!deletados || deletados.length === 0) {
        return NextResponse.json({ error: 'O estorno já foi alterado desde a importação — não é possível remover automaticamente.' }, { status: 409 })
      }
      if (estadoAnterior?.original_id) {
        const { error: erroRestaurar } = await supabase
          .from('transacoes_nubank')
          .update({ status: estadoAnterior.status_anterior ?? 'PENDENTE' })
          .eq('id', estadoAnterior.original_id)
          .eq('status', 'ESTORNADO')
        if (erroRestaurar) console.error('[detalhes/[linhaId]] falha ao restaurar status original:', erroRestaurar.message)
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'estorno_removido', transacao_id: null })
      await registrarLogServidor(supabase, 'excluir', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- estorno_removido -> reaplicar (reinserir o estorno e, se possível, reaplicar no original) ---
    if (linha.decisao === 'estorno_removido' && acaoPedida === 'reaplicar') {
      const estadoAnterior = linha.estado_anterior as EstadoAnteriorEstorno | null
      const originalId = estadoAnterior?.original_id ?? null
      const { id: novoId, ok } = await inserirRegistro(supabase, {
        ...linha.dados_linha,
        status: 'ESTORNO',
        conciliacao_ref: originalId,
      })
      if (!ok) {
        return NextResponse.json({ error: 'Já existe um estorno com os mesmos dados. Não é possível reinserir.' }, { status: 409 })
      }
      let novaDecisao: Decisao = 'estorno_registrado'
      if (originalId) {
        const { data: restaurado } = await supabase
          .from('transacoes_nubank')
          .update({ status: 'ESTORNADO' })
          .eq('id', originalId)
          .eq('status', estadoAnterior?.status_anterior ?? 'PENDENTE')
          .select('id')
        if (restaurado && restaurado.length > 0) novaDecisao = 'estorno_aplicado'
      }
      const atualizada = await atualizarLinha(supabase, { decisao: novaDecisao, transacao_id: novoId })
      await registrarLogServidor(supabase, 'inserir', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    // --- estorno_ignorado -> estorno_registrado (forçar inserção mesmo já havendo hash duplicado) ---
    if (linha.decisao === 'estorno_ignorado' && acaoPedida === 'reaplicar') {
      const { id: novoId, ok } = await inserirRegistro(supabase, { ...linha.dados_linha, status: 'ESTORNO' })
      if (!ok) {
        return NextResponse.json({ error: 'Já existe um estorno com o mesmo hash — não é possível inserir de novo.' }, { status: 409 })
      }
      const atualizada = await atualizarLinha(supabase, { decisao: 'estorno_registrado', transacao_id: novoId })
      await registrarLogServidor(supabase, 'inserir', linha.descricao, linha.valor)
      return NextResponse.json({ linha: atualizada })
    }

    if (linha.decisao === 'conflito') {
      return NextResponse.json({ error: 'Conflitos de conciliação são resolvidos pelo sino de notificações (aprovar/recusar).' }, { status: 400 })
    }

    return NextResponse.json({ error: `A decisão "${linha.decisao}" não pode ser revertida por aqui.` }, { status: 400 })
  } catch (error) {
    console.error('[nubank/atividades/detalhes] Exceção:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
