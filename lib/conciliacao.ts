import { SupabaseClient } from '@supabase/supabase-js'
import { TransacaoNubank, normalizarDescricaoParaHash } from '@/lib/csvparser'

function adicionarDias(dataISO: string, dias: number): string {
  const d = new Date(dataISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}

export type OrigemImportacao = 'csv' | 'api'
export type AcaoConciliacao = 'conciliado' | 'ignorado' | 'inserido' | 'conflito'

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
  const normDesc = normalizarDescricaoParaHash(item.descricao)

  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('id, descricao, valor, data_compra, status')
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)
    .neq('status', 'CONFLITO_VALOR')

  if (error?.message?.includes('data_compra')) {
    const { data: data2 } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data, status')
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .neq('status', 'CONFLITO_VALOR')
    return (data2 ?? [])
      .filter(r => normalizarDescricaoParaHash(r.descricao) === normDesc)
      .map(r => ({ ...r, data_compra: r.data }))
  }

  return (data ?? []).filter(r => normalizarDescricaoParaHash(r.descricao) === normDesc)
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
  const valorOrigFmt = original.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const valorNovoFmt = entrada.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  await supabase.from('notificacoes').insert({
    de_usuario: 'sistema',
    nome_usuario: 'Sistema',
    acao: 'conciliacao_conflito',
    descricao: `Conflito de valor em "${entrada.descricao}": R$ ${valorOrigFmt} → R$ ${valorNovoFmt}`,
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

export async function conciliarTransacao(
  supabase: SupabaseClient,
  item: TransacaoNubank,
  origem: OrigemImportacao
): Promise<ResultadoConciliacao> {
  // 1. Hash pre-check: se o hash já existe, é duplicata exata → ignora
  const { count: hashCount } = await supabase
    .from('transacoes_nubank')
    .select('*', { count: 'exact', head: true })
    .eq('hash_linha', item.hash_linha)
  if ((hashCount ?? 0) > 0) return { acao: 'ignorado', inseriu: false }

  // 2. Buscar match por nome (LOWER estrito) + data (±3 dias)
  const matches = await buscarMatchNomeData(supabase, item)

  if (matches.length > 0) {
    // Escolhe o match com menor diferença de valor
    const match = matches.reduce((best, cur) =>
      Math.abs(cur.valor - item.valor) < Math.abs(best.valor - item.valor) ? cur : best
    )
    const diffValor = Math.abs(match.valor - item.valor)

    if (diffValor <= 0.05) {
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
      return { acao: 'ignorado', inseriu: false }
    }

    // Match parcial: nome + data coincidem, mas valor difere > R$0,05
    // Insere novo registro com flag CONFLITO_VALOR
    const payload: Record<string, unknown> = {
      ...item,
      status: 'CONFLITO_VALOR',
      conciliacao_ref: match.id,
    }
    const { id: conflito_id, ok } = await inserirRegistro(supabase, payload)
    if (!ok) return { acao: 'ignorado', inseriu: false }

    if (conflito_id) {
      await criarNotificacaoConflito(supabase, match, item, conflito_id)
    }
    return { acao: 'conflito', inseriu: true }
  }

  // 3. Sem match: insere como PENDENTE
  const payload: Record<string, unknown> = { ...item, status: 'PENDENTE' }
  const { ok } = await inserirRegistro(supabase, payload)
  return { acao: 'inserido', inseriu: ok }
}
