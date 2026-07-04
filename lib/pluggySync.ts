import { SupabaseClient } from '@supabase/supabase-js'
import { getItem, getAccounts, getAllTransactions } from '@/lib/pluggy'
import { processarTransacoesJSON, TransacaoInputJSON, TransacaoNubank } from '@/lib/csvparser'
import { conciliarTransacao, conciliarEstorno } from '@/lib/conciliacao'
import { categorizarTransacoes } from '@/lib/categorizarTransacoes'
import { notificarImportacao } from '@/lib/pushImportacao'

const ESTADOS_PRECISAM_RECONECTAR = new Set(['LOGIN_ERROR', 'WAITING_USER_INPUT'])
const MAX_ERROS_CONSECUTIVOS = 5

export interface ResultadoSyncPluggy {
  itemId: string
  status: 'ok' | 'needs_reconnect' | 'error' | 'not_configured'
  novasTransacoes: number
  conflitos: number
  erro?: string
}

async function getConfig(supabase: SupabaseClient, chave: string, fallback: string): Promise<string> {
  const { data } = await supabase.from('configuracoes').select('valor').eq('chave', chave).maybeSingle()
  return data?.valor ?? fallback
}

/**
 * Sincroniza as transações do cartão de crédito Nubank via Pluggy.
 * Agnóstica de quem chama (botão manual, cron ou webhook) — o mesmo caminho
 * é exercitado nos três casos, dado o `supabase` client correto (service
 * role para cron/webhook, sessão do usuário para o botão manual).
 */
export async function sincronizarNubankPluggy(supabase: SupabaseClient): Promise<ResultadoSyncPluggy> {
  const { data: pluggyItem } = await supabase
    .from('pluggy_items')
    .select('*')
    .eq('cartao', 'nubank')
    .maybeSingle()

  if (!pluggyItem) {
    return { itemId: '', status: 'not_configured', novasTransacoes: 0, conflitos: 0, erro: 'Nenhuma conexão Nubank configurada.' }
  }

  const itemId: string = pluggyItem.pluggy_item_id

  // 1. Refetch autoritativo do estado do item — nunca confiar apenas no
  // payload do webhook.
  let item
  try {
    item = await getItem(itemId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabase
      .from('pluggy_items')
      .update({ last_sync_at: new Date().toISOString(), last_error_message: msg })
      .eq('pluggy_item_id', itemId)
    return { itemId, status: 'error', novasTransacoes: 0, conflitos: 0, erro: msg }
  }

  const now = new Date().toISOString()

  if (ESTADOS_PRECISAM_RECONECTAR.has(item.status)) {
    await supabase
      .from('pluggy_items')
      .update({
        status: item.status,
        execution_status: item.executionStatus,
        raw_item: item,
        last_sync_at: now,
        needs_user_action: true,
        last_error_code: item.error?.code ?? null,
        last_error_message: item.error?.message ?? null,
      })
      .eq('pluggy_item_id', itemId)
    // Notifica só na transição para não-conectado → não-conectado, evitando spam a cada tick diário do cron.
    if (!pluggyItem.needs_user_action) {
      await notificarImportacao(supabase, 'erro', undefined, undefined, 'nubank', undefined, { importTs: Date.now() })
    }
    return { itemId, status: 'needs_reconnect', novasTransacoes: 0, conflitos: 0, erro: item.error?.message }
  }

  const isErro = item.status !== 'UPDATED'
  const consecutiveErrors = isErro ? (pluggyItem.consecutive_errors ?? 0) + 1 : 0
  const needsUserAction = isErro && consecutiveErrors >= MAX_ERROS_CONSECUTIVOS

  await supabase
    .from('pluggy_items')
    .update({
      status: item.status,
      execution_status: item.executionStatus,
      raw_item: item,
      last_sync_at: now,
      consecutive_errors: consecutiveErrors,
      needs_user_action: needsUserAction,
      last_error_code: item.error?.code ?? null,
      last_error_message: item.error?.message ?? null,
      ...(isErro ? {} : { last_successful_sync_at: now }),
    })
    .eq('pluggy_item_id', itemId)

  if (isErro) {
    return {
      itemId,
      status: needsUserAction ? 'needs_reconnect' : 'error',
      novasTransacoes: 0,
      conflitos: 0,
      erro: item.error?.message ?? `Item em estado ${item.status}`,
    }
  }

  // 2. Localiza a conta de cartão de crédito dentro do item.
  const contas = await getAccounts(itemId)
  const contaCartao = contas.find(c => c.type === 'CREDIT')
  if (!contaCartao) {
    const msg = 'Conta de cartão de crédito não encontrada no item Pluggy.'
    await supabase.from('pluggy_items').update({ last_error_message: msg }).eq('pluggy_item_id', itemId)
    return { itemId, status: 'error', novasTransacoes: 0, conflitos: 0, erro: msg }
  }

  // 3. Busca transações no período configurado.
  const diaVencimento = parseInt(await getConfig(supabase, 'dia_vencimento', '10'))
  const ajusteFechamento = parseInt(await getConfig(supabase, 'ajuste_fechamento', '0'))
  const windowDays = parseInt(await getConfig(supabase, 'pluggy_sync_window_days', '90'))

  const to = new Date()
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000)
  const fromISO = from.toISOString().substring(0, 10)
  const toISO = to.toISOString().substring(0, 10)

  const transacoesPluggy = await getAllTransactions(contaCartao.id, fromISO, toISO)

  if (transacoesPluggy.length === 0) {
    return { itemId, status: 'ok', novasTransacoes: 0, conflitos: 0 }
  }

  // 4. Filtra as já importadas (idempotência por pluggy_transaction_id).
  const idsPluggy = transacoesPluggy.map(t => t.id)
  const { data: jaImportadas } = await supabase
    .from('transacoes_nubank')
    .select('pluggy_transaction_id')
    .in('pluggy_transaction_id', idsPluggy)

  const idsJaImportados = new Set((jaImportadas ?? []).map(r => r.pluggy_transaction_id))
  const novasPluggy = transacoesPluggy.filter(t => !idsJaImportados.has(t.id))

  if (novasPluggy.length === 0) {
    return { itemId, status: 'ok', novasTransacoes: 0, conflitos: 0 }
  }

  // 5. Mapeia para o formato compartilhado com a importação via CSV/API.
  const inputs: TransacaoInputJSON[] = novasPluggy.map(t => ({
    date: t.date.substring(0, 10),
    title: t.description,
    amount: t.amount,
  }))
  const transacoes: TransacaoNubank[] = processarTransacoesJSON(inputs, diaVencimento, ajusteFechamento, 'nubank')

  let novas = 0
  let conflitos = 0
  const hashesImportados: string[] = []
  const purchaseDates: string[] = []
  const projetoFaturas: string[] = []
  let estornosAplicados = 0
  let estornosRegistrados = 0

  for (let i = 0; i < transacoes.length; i++) {
    const t = transacoes[i]
    const pluggyId = novasPluggy[i]?.id

    if (t.is_estorno) {
      const resultado = await conciliarEstorno(supabase, t)
      if (resultado.acao === 'aplicado') estornosAplicados++
      if (resultado.acao === 'registrado') estornosRegistrados++
      if (resultado.inseriu && pluggyId) {
        await supabase
          .from('transacoes_nubank')
          .update({ pluggy_transaction_id: pluggyId, origem_dado: 'pluggy' })
          .eq('hash_linha', t.hash_linha)
      }
      continue
    }

    const resultado = await conciliarTransacao(supabase, t, 'api')
    if (resultado.acao === 'inserido' && resultado.inseriu) {
      novas++
      hashesImportados.push(t.hash_linha)
      purchaseDates.push(t.data_compra)
      projetoFaturas.push(t.projeto_fatura)
      if (pluggyId) {
        await supabase
          .from('transacoes_nubank')
          .update({ pluggy_transaction_id: pluggyId, origem_dado: 'pluggy' })
          .eq('hash_linha', t.hash_linha)
      }
    } else if (resultado.acao === 'conflito') {
      conflitos++
      purchaseDates.push(t.data_compra)
      projetoFaturas.push(t.projeto_fatura)
    }
  }

  await supabase.from('activity_logs').insert({
    acao: 'importar',
    tabela: 'transacoes_nubank',
    descricao: `${novas} novas via Pluggy (sincronização automática Nubank)`,
  })

  if (hashesImportados.length > 0) {
    const geminiKey = process.env.GEMINI_API_KEY
    if (geminiKey) {
      try {
        await categorizarTransacoes(supabase, geminiKey, hashesImportados, true)
      } catch (err) {
        console.error('[pluggySync] Erro na categorização:', err)
      }
    }
  }

  await notificarImportacao(supabase, 'sucesso', novas, conflitos, 'nubank', undefined, {
    purchaseDates,
    projetoFaturas,
    importTs: Date.now(),
    estornosAplicados,
    estornosRegistrados,
  })

  return { itemId, status: 'ok', novasTransacoes: novas, conflitos }
}
