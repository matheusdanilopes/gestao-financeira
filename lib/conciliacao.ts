import { SupabaseClient } from '@supabase/supabase-js'
import { TransacaoNubank, normalizarDescricaoParaHash } from '@/lib/csvparser'
import { descricoesParecidas } from '@/lib/descricaoSimilaridade'
import { formatBRL } from '@/lib/logger'

function adicionarDias(dataISO: string, dias: number): string {
  const d = new Date(dataISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}

export type OrigemImportacao = 'csv' | 'api'
export type AcaoConciliacao = 'conciliado' | 'ignorado' | 'inserido' | 'conflito' | 'estorno'
export type AcaoEstorno = 'aplicado' | 'registrado' | 'ignorado'

export interface ResultadoConciliacao {
  acao: AcaoConciliacao
  inseriu: boolean
}

interface TransacaoMatch {
  id: string
  descricao: string
  valor: number
  data_compra: string
}

async function buscarMatchNomeData(
  supabase: SupabaseClient,
  item: TransacaoNubank
): Promise<TransacaoMatch[]> {
  const dataInicio = adicionarDias(item.data_compra, -3)
  const dataFim = adicionarDias(item.data_compra, 3)
  const cartao = item.cartao ?? 'nubank'

  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('id, descricao, valor, data_compra, status')
    .eq('cartao', cartao)
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)
    .neq('status', 'CONFLITO_VALOR')

  if (error?.message?.includes('data_compra')) {
    const { data: data2 } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data, status')
      .eq('cartao', cartao)
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .neq('status', 'CONFLITO_VALOR')
    return (data2 ?? [])
      .filter(r => descricoesParecidas(r.descricao, item.descricao))
      .map(r => ({ ...r, data_compra: r.data }))
  }

  return (data ?? []).filter(r => descricoesParecidas(r.descricao, item.descricao))
}

async function inserirRegistro(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<{ id: string | null; ok: boolean }> {
  let result = await supabase
    .from('transacoes_nubank')
    .insert(payload)
    .select('id')
    .single()

  if (result.error?.message?.includes('data_compra')) {
    const { data_compra, ...resto } = payload as Record<string, unknown>
    result = await supabase
      .from('transacoes_nubank')
      .insert({ ...resto, data: data_compra })
      .select('id')
      .single()
  }

  if (!result.error) return { id: result.data?.id ?? null, ok: true }
  if (result.error.code === '23505' || result.error.message?.includes('duplicate')) {
    return { id: null, ok: false }
  }
  throw new Error('Erro ao salvar: ' + result.error.message)
}

async function criarNotificacaoConflito(
  supabase: SupabaseClient,
  original: TransacaoMatch,
  entrada: TransacaoNubank,
  conflito_id: string
) {
  await supabase.from('notificacoes').insert({
    de_usuario: 'sistema',
    nome_usuario: 'Sistema',
    acao: 'conciliacao_conflito',
    descricao: `Conflito de valor em "${entrada.descricao}": ${formatBRL(original.valor)} → ${formatBRL(entrada.valor)}`,
    valor: entrada.valor,
    metadata: {
      original_id: original.id,
      conflito_id,
      valor_original: original.valor,
      valor_novo: entrada.valor,
      descricao: entrada.descricao,
      data_compra: entrada.data_compra,
    },
  })
}

function buildPayload(item: TransacaoNubank, extra: Record<string, unknown>): Record<string, unknown> {
  const { occurrence_index: _oi, ...base } = item as TransacaoNubank & { occurrence_index?: number }
  return { ...base, ...extra }
}

export async function conciliarEstorno(
  supabase: SupabaseClient,
  estorno: TransacaoNubank
): Promise<{ acao: AcaoEstorno; inseriu: boolean }> {
  // 1. Hash dedup — evita reprocessar o mesmo estorno em reimportação
  const { count: hashCount } = await supabase
    .from('transacoes_nubank')
    .select('*', { count: 'exact', head: true })
    .eq('hash_linha', estorno.hash_linha)

  if ((hashCount ?? 0) > 0) {
    console.log(`[conciliacao] estorno ignorado (hash duplicado) hash=${estorno.hash_linha.slice(0, 12)} desc="${estorno.descricao}"`)
    return { acao: 'ignorado', inseriu: false }
  }

  // 2. Busca transação original: normaliza descrição do estorno para extrair nome do lojista.
  //    NuBank usa dois formatos: "Estorno de Loja X" e "Estorno de compra (Loja X 2x de 12x)".
  const descNorm = estorno.descricao
    .replace(/^estorno\s+de\s+compra\s*\(/i, '') // "Estorno de compra (Loja..." → "Loja..."
    .replace(/^estorno\s+de\s+/i, '')             // "Estorno de Loja..." → "Loja..."
    .replace(/\s*\d+x\s+de\s+\d+x\s*\)?$/i, '')  // remove sufixo de parcela "2x de 12x)"
    .replace(/\)$/, '')                            // remove parêntese final residual
    .trim()
  const descOriginal = normalizarDescricaoParaHash(descNorm)
  const dataInicio = adicionarDias(estorno.data_compra, -30)
  const dataFim    = adicionarDias(estorno.data_compra, 30)
  const cartaoEstorno = estorno.cartao ?? 'nubank'

  const { data: candidates, error: candidatesError } = await supabase
    .from('transacoes_nubank')
    .select('id, descricao, valor, data_compra, status')
    .eq('cartao', cartaoEstorno)
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)
    .in('status', ['PENDENTE', 'CONCILIADO'])

  // Fallback para coluna 'data' (schema antigo)
  const rows = candidatesError?.message?.includes('data_compra')
    ? await supabase
        .from('transacoes_nubank')
        .select('id, descricao, valor, data, status')
        .eq('cartao', cartaoEstorno)
        .gte('data', dataInicio)
        .lte('data', dataFim)
        .in('status', ['PENDENTE', 'CONCILIADO'])
        .then(r => (r.data ?? []).map(x => ({ ...x, data_compra: x.data })))
    : (candidates ?? [])

  const original = rows.find(c =>
    normalizarDescricaoParaHash(c.descricao) === descOriginal &&
    Math.abs(c.valor - estorno.valor) <= 0.05
  )

  // 3. Insere registro do estorno
  const { occurrence_index: _oi, ...base } = estorno as TransacaoNubank & { occurrence_index?: number }
  const payload: Record<string, unknown> = {
    ...base,
    status: 'ESTORNO',
    is_estorno: true,
    conciliacao_ref: original?.id ?? null,
  }
  const { ok } = await inserirRegistro(supabase, payload)
  if (!ok) return { acao: 'ignorado', inseriu: false }

  // 4. Marca original como ESTORNADO se encontrado e cria notificação in-app
  if (original) {
    await supabase
      .from('transacoes_nubank')
      .update({ status: 'ESTORNADO' })
      .eq('id', original.id)
    await supabase.from('notificacoes').insert({
      de_usuario: 'sistema',
      nome_usuario: 'Sistema',
      acao: 'estorno_aplicado',
      descricao: `Estorno detectado em "${original.descricao}": ${formatBRL(estorno.valor)} devolvido.`,
      valor: estorno.valor,
      metadata: {
        original_id: original.id,
        descricao: original.descricao,
        valor: estorno.valor,
        data_compra: estorno.data_compra,
      },
    })
    console.log(`[conciliacao] estorno aplicado → original id=${original.id} desc="${original.descricao}"`)
    return { acao: 'aplicado', inseriu: true }
  }

  console.log(`[conciliacao] estorno registrado sem match desc="${estorno.descricao}" data=${estorno.data_compra}`)
  return { acao: 'registrado', inseriu: true }
}

export async function conciliarTransacao(
  supabase: SupabaseClient,
  item: TransacaoNubank,
  origem: OrigemImportacao
): Promise<ResultadoConciliacao> {
  // occurrence_index indica a Nª ocorrência desta combinação (data|desc|valor) no lote.
  // Valor 1 é o caso normal (retrocompatível); >1 significa compra legítima repetida.
  const occurrenceIndex = (item as TransacaoNubank & { occurrence_index?: number }).occurrence_index ?? 1

  // 1. Hash pre-check: se o hash já existe, é reimportação desta linha exata → ignora
  const { count: hashCount } = await supabase
    .from('transacoes_nubank')
    .select('*', { count: 'exact', head: true })
    .eq('hash_linha', item.hash_linha)

  if ((hashCount ?? 0) > 0) {
    console.log(`[conciliacao] ignorado (hash duplicado) hash=${item.hash_linha.slice(0, 12)} desc="${item.descricao}" data=${item.data_compra} valor=${item.valor}`)
    return { acao: 'ignorado', inseriu: false }
  }

  // 2. Buscar match por nome (LOWER estrito) + data (±3 dias)
  const matches = await buscarMatchNomeData(supabase, item)

  if (matches.length > 0) {
    const match = matches.reduce((best, cur) =>
      Math.abs(cur.valor - item.valor) < Math.abs(best.valor - item.valor) ? cur : best
    )
    const diffValor = Math.abs(match.valor - item.valor)

    if (diffValor <= 0.05) {
      // Conta quantos registros próximos já existem no banco para esta combinação.
      // Se o banco tiver menos do que o índice da ocorrência atual, é uma compra
      // legítima repetida (ex.: dois IFOODs no mesmo dia) → insere normalmente.
      const closeMatchCount = matches.filter(m => Math.abs(m.valor - item.valor) <= 0.05).length

      if (closeMatchCount < occurrenceIndex) {
        console.log(`[conciliacao] inserido (ocorrência ${occurrenceIndex}, ${closeMatchCount} no banco) desc="${item.descricao}" data=${item.data_compra} valor=${item.valor}`)
        const payload = buildPayload(item, { status: 'PENDENTE' })
        const { ok } = await inserirRegistro(supabase, payload)
        return { acao: 'inserido', inseriu: ok }
      }

      // Match completo (nome + data + valor dentro da tolerância)
      if (origem === 'csv') {
        // CSV é autoridade: atualiza valor_final e marca como CONCILIADO
        await supabase
          .from('transacoes_nubank')
          .update({ valor_final: item.valor, status: 'CONCILIADO' })
          .eq('id', match.id)
        return { acao: 'conciliado', inseriu: false }
      }
      // API: ignora entrada redundante
      console.log(`[conciliacao] ignorado (match nome+data+valor) desc="${item.descricao}" data=${item.data_compra} valor=${item.valor}`)
      return { acao: 'ignorado', inseriu: false }
    }

    // Match parcial: nome + data coincidem, mas valor difere > R$0,05
    // Acima de R$2,00 de diferença → nova compra direta, sem notificação
    if (diffValor > 2.00) {
      const payload = buildPayload(item, { status: 'PENDENTE' })
      const { ok } = await inserirRegistro(supabase, payload)
      return { acao: 'inserido', inseriu: ok }
    }

    // Entre R$0,05 e R$2,00 → só cria um novo conflito se não existir um pendente para este original.
    // Evita reabrir alerta a cada reimportação da mesma compra (valor "pendente" do Nubank varia até fechar fatura).
    const { data: conflitoExistente } = await supabase
      .from('transacoes_nubank')
      .select('id')
      .eq('conciliacao_ref', match.id)
      .eq('status', 'CONFLITO_VALOR')
      .maybeSingle()

    if (conflitoExistente) {
      console.log(`[conciliacao] conflito já pendente para original=${match.id}, ignorando nova linha desc="${item.descricao}"`)
      return { acao: 'ignorado', inseriu: false }
    }

    const payload = buildPayload(item, { status: 'CONFLITO_VALOR', conciliacao_ref: match.id })
    const { id: conflito_id, ok } = await inserirRegistro(supabase, payload)
    if (!ok) return { acao: 'ignorado', inseriu: false }

    if (conflito_id) {
      await criarNotificacaoConflito(supabase, match, item, conflito_id)
    }
    return { acao: 'conflito', inseriu: true }
  }

  // 3. Sem match: insere como PENDENTE
  const payload = buildPayload(item, { status: 'PENDENTE' })
  const { ok } = await inserirRegistro(supabase, payload)
  return { acao: 'inserido', inseriu: ok }
}
