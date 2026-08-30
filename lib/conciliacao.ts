import { SupabaseClient } from '@supabase/supabase-js'
import { TransacaoNubank, normalizarDescricaoParaHash } from '@/lib/csvparser'
import { descricoesParecidas, normalizarDescricaoSemParcela } from '@/lib/descricaoSimilaridade'
import { formatBRL } from '@/lib/format'

function adicionarDias(dataISO: string, dias: number): string {
  const d = new Date(dataISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}

export type OrigemImportacao = 'csv' | 'api'
export type AcaoConciliacao = 'conciliado' | 'ignorado' | 'inserido' | 'conflito' | 'estorno'
export type AcaoEstorno = 'aplicado' | 'registrado' | 'ignorado'

export interface RegistroConflitante {
  id: string
  descricao: string
  valor: number
  data_compra: string
  status: string
}

export interface ResultadoConciliacao {
  acao: AcaoConciliacao
  inseriu: boolean
  /** id em transacoes_nubank criado/atualizado por esta linha (inserido/conflito/conciliado) */
  transacaoId?: string | null
  /** id em transacoes_nubank já existente que fez esta linha ser ignorada como duplicata */
  matchExistenteId?: string | null
  /** id da notificação conciliacao_conflito criada (só quando acao='conflito') */
  notificacaoId?: string | null
  /** estado do registro conciliado antes desta linha sobrescrever valor/valor_final/status (só acao='conciliado').
   *  data_compra/projeto_fatura só aparecem quando a data também foi corrigida (ver conciliarTransacao). */
  estadoAnterior?: { status: string; valor: number; valor_final: number | null; data_compra?: string; projeto_fatura?: string } | null
  /** snapshot do registro já existente que fez esta linha ser duplicada/conflito (explica por que não foi importada) */
  registroConflitante?: RegistroConflitante | null
}

export interface ResultadoEstorno {
  acao: AcaoEstorno
  inseriu: boolean
  /** id do registro de estorno criado em transacoes_nubank */
  transacaoId?: string | null
  /** id da transação original afetada, quando encontrado match */
  originalId?: string | null
  /** status da transação original antes de ser marcada ESTORNADO */
  statusAnteriorOriginal?: string | null
  /** snapshot do estorno já existente que fez esta linha ser ignorada */
  registroConflitante?: RegistroConflitante | null
}

interface TransacaoMatch {
  id: string
  descricao: string
  valor: number
  data_compra: string
  status: string
  valor_final: number | null
  projeto_fatura: string
}

/**
 * Contexto de conciliação: pré-carrega em poucas queries em lote (em vez de uma
 * query por transação) os dados que conciliarTransacao() precisa para decidir
 * cada linha — dedupe por hash e candidatos de match por nome+data. É atualizado
 * em memória a cada inserção/atualização feita durante o loop, para que o item N
 * "enxergue" os efeitos dos itens 1..N-1 processados antes dele no mesmo lote —
 * exatamente como as queries por item faziam antes (read-after-write), só que sem
 * o round-trip de rede repetido. Passar `contexto` é opcional: sem ele,
 * conciliarTransacao/conciliarEstorno voltam ao comportamento anterior (1 query
 * por item), preservando compatibilidade com qualquer chamador que não o utilize.
 */
export interface ContextoConciliacao {
  hashIndex: Map<string, RegistroConflitante>
  candidatosPorCartao: Map<string, TransacaoMatch[]>
}

export interface ContextoEstorno {
  hashIndex: Map<string, RegistroConflitante>
  candidatosPorCartao: Map<string, RegistroConflitante[]>
}

function agruparPorCartao(itens: TransacaoNubank[]): Map<string, TransacaoNubank[]> {
  const grupos = new Map<string, TransacaoNubank[]>()
  for (const item of itens) {
    const cartao = item.cartao ?? 'nubank'
    const lista = grupos.get(cartao)
    if (lista) lista.push(item)
    else grupos.set(cartao, [item])
  }
  return grupos
}

async function buscarHashesEmLote(
  supabase: SupabaseClient,
  hashes: string[]
): Promise<Map<string, RegistroConflitante>> {
  const hashIndex = new Map<string, RegistroConflitante>()
  if (hashes.length === 0) return hashIndex

  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('id, descricao, valor, data_compra, status, hash_linha')
    .in('hash_linha', hashes)

  const rows = error?.message?.includes('data_compra')
    ? (
        await supabase
          .from('transacoes_nubank')
          .select('id, descricao, valor, data, status, hash_linha')
          .in('hash_linha', hashes)
      ).data?.map(r => ({ ...r, data_compra: r.data })) ?? []
    : data ?? []

  for (const row of rows) {
    hashIndex.set(row.hash_linha, {
      id: row.id,
      descricao: row.descricao,
      valor: row.valor,
      data_compra: row.data_compra,
      status: row.status,
    })
  }
  return hashIndex
}

/**
 * Pré-carrega, em 1 query de hash + 1 query por cartão distinto no lote (em vez de
 * até 2 queries por transação), tudo que conciliarTransacao() precisa para decidir
 * cada linha de compra normal (não-estorno). A janela de data de cada query por
 * cartão cobre ±3 dias da MENOR à MAIOR data do lote — um superconjunto da janela
 * ±3 dias que cada item consultaria individualmente — e o filtro de nome+data é
 * refeito em memória por item, com o mesmo critério (descricoesParecidas) usado
 * antes na query.
 */
export async function construirContextoConciliacao(
  supabase: SupabaseClient,
  transacoesNormais: TransacaoNubank[]
): Promise<ContextoConciliacao> {
  const candidatosPorCartao = new Map<string, TransacaoMatch[]>()
  if (transacoesNormais.length === 0) {
    return { hashIndex: new Map(), candidatosPorCartao }
  }

  const hashIndex = await buscarHashesEmLote(supabase, transacoesNormais.map(t => t.hash_linha))

  for (const [cartao, itens] of agruparPorCartao(transacoesNormais)) {
    const datas = itens.map(i => i.data_compra).sort()
    const dataInicio = adicionarDias(datas[0], -3)
    const dataFim = adicionarDias(datas[datas.length - 1], 3)

    const { data, error } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data_compra, status, valor_final, projeto_fatura')
      .eq('cartao', cartao)
      .gte('data_compra', dataInicio)
      .lte('data_compra', dataFim)
      .neq('status', 'CONFLITO_VALOR')

    const rows: TransacaoMatch[] = error?.message?.includes('data_compra')
      ? (
          await supabase
            .from('transacoes_nubank')
            .select('id, descricao, valor, data, status, valor_final, projeto_fatura')
            .eq('cartao', cartao)
            .gte('data', dataInicio)
            .lte('data', dataFim)
            .neq('status', 'CONFLITO_VALOR')
        ).data?.map(r => ({ ...r, data_compra: r.data })) ?? []
      : data ?? []

    candidatosPorCartao.set(cartao, rows)
  }

  return { hashIndex, candidatosPorCartao }
}

/**
 * Equivalente a construirContextoConciliacao(), mas para estornos: janela ±30 dias
 * e candidatos restritos a status PENDENTE/CONCILIADO (mesmo filtro que a query
 * por item de conciliarEstorno usava). Deve ser chamado DEPOIS do loop de
 * transações normais terminar, para que os candidatos já reflitam as inserções e
 * atualizações desse loop (mesma garantia de leitura pós-escrita que as queries
 * por item ofereciam).
 */
export async function construirContextoEstornos(
  supabase: SupabaseClient,
  estornos: TransacaoNubank[]
): Promise<ContextoEstorno> {
  const candidatosPorCartao = new Map<string, RegistroConflitante[]>()
  if (estornos.length === 0) {
    return { hashIndex: new Map(), candidatosPorCartao }
  }

  const hashIndex = await buscarHashesEmLote(supabase, estornos.map(e => e.hash_linha))

  for (const [cartao, itens] of agruparPorCartao(estornos)) {
    const datas = itens.map(i => i.data_compra).sort()
    const dataInicio = adicionarDias(datas[0], -30)
    const dataFim = adicionarDias(datas[datas.length - 1], 30)

    const { data, error } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data_compra, status')
      .eq('cartao', cartao)
      .gte('data_compra', dataInicio)
      .lte('data_compra', dataFim)
      .in('status', ['PENDENTE', 'CONCILIADO'])

    const rows: RegistroConflitante[] = error?.message?.includes('data_compra')
      ? (
          await supabase
            .from('transacoes_nubank')
            .select('id, descricao, valor, data, status')
            .eq('cartao', cartao)
            .gte('data', dataInicio)
            .lte('data', dataFim)
            .in('status', ['PENDENTE', 'CONCILIADO'])
        ).data?.map(r => ({ ...r, data_compra: r.data })) ?? []
      : data ?? []

    candidatosPorCartao.set(cartao, rows)
  }

  return { hashIndex, candidatosPorCartao }
}

function buscarMatchNomeDataEmContexto(contexto: ContextoConciliacao, item: TransacaoNubank): TransacaoMatch[] {
  const dataInicio = adicionarDias(item.data_compra, -3)
  const dataFim = adicionarDias(item.data_compra, 3)
  const candidatos = contexto.candidatosPorCartao.get(item.cartao ?? 'nubank') ?? []
  return candidatos
    .filter(r => r.data_compra >= dataInicio && r.data_compra <= dataFim)
    .filter(r => descricoesParecidas(r.descricao, item.descricao))
}

function adicionarCandidato(contexto: ContextoConciliacao, cartao: string, registro: TransacaoMatch): void {
  const lista = contexto.candidatosPorCartao.get(cartao)
  if (lista) lista.push(registro)
  else contexto.candidatosPorCartao.set(cartao, [registro])
}

function atualizarCandidato(
  contexto: ContextoConciliacao,
  cartao: string,
  id: string,
  patch: Partial<TransacaoMatch>
): void {
  const lista = contexto.candidatosPorCartao.get(cartao)
  const idx = lista?.findIndex(r => r.id === id) ?? -1
  if (lista && idx !== -1) lista[idx] = { ...lista[idx], ...patch }
}

function atualizarCandidatoEstorno(
  contexto: ContextoEstorno,
  cartao: string,
  id: string,
  patch: Partial<RegistroConflitante>
): void {
  const lista = contexto.candidatosPorCartao.get(cartao)
  const idx = lista?.findIndex(r => r.id === id) ?? -1
  if (lista && idx !== -1) lista[idx] = { ...lista[idx], ...patch }
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
    .select('id, descricao, valor, data_compra, status, valor_final, projeto_fatura')
    .eq('cartao', cartao)
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)
    .neq('status', 'CONFLITO_VALOR')

  if (error?.message?.includes('data_compra')) {
    const { data: data2 } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data, status, valor_final, projeto_fatura')
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

async function buscarPorHash(supabase: SupabaseClient, hashLinha: string): Promise<RegistroConflitante | null> {
  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('id, descricao, valor, data_compra, status')
    .eq('hash_linha', hashLinha)
    .maybeSingle()

  if (error?.message?.includes('data_compra')) {
    const { data: data2 } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data, status')
      .eq('hash_linha', hashLinha)
      .maybeSingle()
    return data2 ? { ...data2, data_compra: data2.data } : null
  }

  return data ?? null
}

export async function inserirRegistro(
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

async function atualizarRegistroConciliado(
  supabase: SupabaseClient,
  matchId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('transacoes_nubank').update(payload).eq('id', matchId)
  if (error?.message?.includes('data_compra') && 'data_compra' in payload) {
    const { data_compra, ...resto } = payload
    await supabase.from('transacoes_nubank').update({ ...resto, data: data_compra }).eq('id', matchId)
  }
}

async function criarNotificacaoConflito(
  supabase: SupabaseClient,
  original: TransacaoMatch,
  entrada: TransacaoNubank,
  conflito_id: string
): Promise<string | null> {
  const { data } = await supabase.from('notificacoes').insert({
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
  }).select('id').single()
  return data?.id ?? null
}

function buildPayload(item: TransacaoNubank, extra: Record<string, unknown>): Record<string, unknown> {
  const { occurrence_index: _oi, ...base } = item as TransacaoNubank & { occurrence_index?: number }
  return { ...base, ...extra }
}

/**
 * Para cada transação do lote que seja parcela N/X com N > 1, busca a parcela
 * imediatamente anterior da mesma compra (mesmo cartão, mesmo total de parcelas,
 * descrição igual ignorando o número da parcela atual) — primeiro dentro do próprio
 * lote importado (compra nova, com 1/X e 2/X no mesmo arquivo), depois no banco — e
 * sobrescreve item.responsavel para manter o mesmo responsável em toda a série.
 * Transações sem parcela anterior encontrada mantêm o responsável já calculado
 * (heurística de descrição/responsavelPadrao).
 *
 * A busca no banco é feita em 1 query por combinação (cartão, total_parcelas)
 * presente no lote — em vez de 1 query por transação parcelada — trazendo todas as
 * parcelas anteriores candidatas de uma vez; o filtro "parcela_atual < parcela
 * atual desta transação" que antes ia na query é aplicado em memória, com o mesmo
 * critério de antes.
 */
export async function aplicarResponsavelDeParcelaAnterior(
  supabase: SupabaseClient,
  transacoes: TransacaoNubank[]
): Promise<void> {
  const candidatosParceladas = transacoes.filter(
    item => !item.is_estorno && item.total_parcelas && item.parcela_atual && item.parcela_atual > 1
  )

  const gruposNecessarios = new Map<string, { cartao: string; total_parcelas: number }>()
  for (const item of candidatosParceladas) {
    const cartao = item.cartao ?? 'nubank'
    const chave = `${cartao}|${item.total_parcelas}`
    if (!gruposNecessarios.has(chave)) gruposNecessarios.set(chave, { cartao, total_parcelas: item.total_parcelas! })
  }

  const parcelasAnterioresPorGrupo = new Map<string, Array<{ descricao: string; responsavel: string | null; parcela_atual: number }>>()
  for (const [chave, { cartao, total_parcelas }] of gruposNecessarios) {
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('descricao, responsavel, parcela_atual')
      .eq('cartao', cartao)
      .eq('total_parcelas', total_parcelas)
      .eq('is_estorno', false)
      .order('parcela_atual', { ascending: false })
    parcelasAnterioresPorGrupo.set(chave, data ?? [])
  }

  for (const item of transacoes) {
    if (item.is_estorno || !item.total_parcelas || !item.parcela_atual || item.parcela_atual <= 1) continue

    const cartao = item.cartao ?? 'nubank'
    const descBase = normalizarDescricaoSemParcela(item.descricao)

    const candidatoNoLote = transacoes
      .filter(t =>
        t !== item &&
        !t.is_estorno &&
        (t.cartao ?? 'nubank') === cartao &&
        t.total_parcelas === item.total_parcelas &&
        (t.parcela_atual ?? 0) < item.parcela_atual! &&
        normalizarDescricaoSemParcela(t.descricao) === descBase
      )
      .sort((a, b) => (b.parcela_atual ?? 0) - (a.parcela_atual ?? 0))[0]

    let responsavelAnterior: 'Matheus' | 'Jeniffer' | 'Conjunto' | null

    if (candidatoNoLote) {
      responsavelAnterior = candidatoNoLote.responsavel
    } else {
      const registros = parcelasAnterioresPorGrupo.get(`${cartao}|${item.total_parcelas}`) ?? []
      const anterior = registros.find(
        r => r.parcela_atual < item.parcela_atual! && normalizarDescricaoSemParcela(r.descricao) === descBase
      )
      responsavelAnterior = (anterior?.responsavel as 'Matheus' | 'Jeniffer' | 'Conjunto' | undefined) ?? null
    }

    if (responsavelAnterior) item.responsavel = responsavelAnterior
  }
}

export async function conciliarEstorno(
  supabase: SupabaseClient,
  estorno: TransacaoNubank,
  contexto?: ContextoEstorno
): Promise<ResultadoEstorno> {
  const cartaoEstorno = estorno.cartao ?? 'nubank'

  // 1. Hash dedup — evita reprocessar o mesmo estorno em reimportação
  const hashMatch = contexto
    ? contexto.hashIndex.get(estorno.hash_linha) ?? null
    : await buscarPorHash(supabase, estorno.hash_linha)

  if (hashMatch) {
    console.log(`[conciliacao] estorno ignorado (hash duplicado) hash=${estorno.hash_linha.slice(0, 12)} desc="${estorno.descricao}"`)
    return { acao: 'ignorado', inseriu: false, registroConflitante: hashMatch }
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

  let rows: RegistroConflitante[]
  if (contexto) {
    const candidatos = contexto.candidatosPorCartao.get(cartaoEstorno) ?? []
    rows = candidatos.filter(c => c.data_compra >= dataInicio && c.data_compra <= dataFim)
  } else {
    const { data: candidates, error: candidatesError } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data_compra, status')
      .eq('cartao', cartaoEstorno)
      .gte('data_compra', dataInicio)
      .lte('data_compra', dataFim)
      .in('status', ['PENDENTE', 'CONCILIADO'])

    // Fallback para coluna 'data' (schema antigo)
    rows = candidatesError?.message?.includes('data_compra')
      ? await supabase
          .from('transacoes_nubank')
          .select('id, descricao, valor, data, status')
          .eq('cartao', cartaoEstorno)
          .gte('data', dataInicio)
          .lte('data', dataFim)
          .in('status', ['PENDENTE', 'CONCILIADO'])
          .then(r => (r.data ?? []).map(x => ({ ...x, data_compra: x.data })))
      : (candidates ?? [])
  }

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
  const { id: estornoId, ok } = await inserirRegistro(supabase, payload)
  if (!ok) return { acao: 'ignorado', inseriu: false }

  if (contexto && estornoId) {
    contexto.hashIndex.set(estorno.hash_linha, {
      id: estornoId,
      descricao: estorno.descricao,
      valor: estorno.valor,
      data_compra: estorno.data_compra,
      status: 'ESTORNO',
    })
  }

  // 4. Marca original como ESTORNADO se encontrado e cria notificação in-app
  if (original) {
    await supabase
      .from('transacoes_nubank')
      .update({ status: 'ESTORNADO' })
      .eq('id', original.id)
    if (contexto) atualizarCandidatoEstorno(contexto, cartaoEstorno, original.id, { status: 'ESTORNADO' })
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
    return {
      acao: 'aplicado',
      inseriu: true,
      transacaoId: estornoId,
      originalId: original.id,
      statusAnteriorOriginal: original.status,
    }
  }

  console.log(`[conciliacao] estorno registrado sem match desc="${estorno.descricao}" data=${estorno.data_compra}`)
  return { acao: 'registrado', inseriu: true, transacaoId: estornoId, originalId: null, statusAnteriorOriginal: null }
}

export async function conciliarTransacao(
  supabase: SupabaseClient,
  item: TransacaoNubank,
  origem: OrigemImportacao,
  contexto?: ContextoConciliacao
): Promise<ResultadoConciliacao> {
  // occurrence_index indica a Nª ocorrência desta combinação (data|desc|valor) no lote.
  // Valor 1 é o caso normal (retrocompatível); >1 significa compra legítima repetida.
  const occurrenceIndex = (item as TransacaoNubank & { occurrence_index?: number }).occurrence_index ?? 1
  const cartao = item.cartao ?? 'nubank'

  // 1. Hash pre-check: se o hash já existe, é reimportação desta linha exata → ignora
  const hashMatch = contexto
    ? contexto.hashIndex.get(item.hash_linha) ?? null
    : await buscarPorHash(supabase, item.hash_linha)

  if (hashMatch) {
    console.log(`[conciliacao] ignorado (hash duplicado) hash=${item.hash_linha.slice(0, 12)} desc="${item.descricao}" data=${item.data_compra} valor=${item.valor}`)
    return { acao: 'ignorado', inseriu: false, matchExistenteId: hashMatch.id, registroConflitante: hashMatch }
  }

  // 2. Buscar match por nome (LOWER estrito) + data (±3 dias)
  const matches = contexto
    ? buscarMatchNomeDataEmContexto(contexto, item)
    : await buscarMatchNomeData(supabase, item)

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
        const { id, ok } = await inserirRegistro(supabase, payload)
        if (ok && id && contexto) {
          contexto.hashIndex.set(item.hash_linha, { id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'PENDENTE' })
          adicionarCandidato(contexto, cartao, { id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'PENDENTE', valor_final: null, projeto_fatura: item.projeto_fatura })
        }
        return { acao: 'inserido', inseriu: ok, transacaoId: id }
      }

      // Match completo (nome + data + valor dentro da tolerância): a fonte mais recente
      // (CSV ou API) é autoridade sobre o valor final da compra — atualiza valor_final
      // e marca como CONCILIADO em ambos os casos.
      //
      // Além disso, o NuBank às vezes revisa a data de uma compra já importada entre uma
      // exportação e outra (ex.: uma compra do dia 24 aparece como dia 25 numa reimportação
      // — o dia do fechamento). Quando isso muda o projeto_fatura calculado pela fórmula
      // (item.projeto_fatura, já calculado a partir de item.data_compra por quem chamou),
      // a transação existente é corrigida para a fatura certa em vez de ficar presa na
      // fatura antiga — sem isso o valor da fatura no app diverge do NuBank exatamente
      // nesse tipo de compra de virada.
      const faturaMudou = item.projeto_fatura !== match.projeto_fatura
      const atualizacao: Record<string, unknown> = { valor_final: item.valor, status: 'CONCILIADO' }
      if (faturaMudou) {
        atualizacao.data_compra = item.data_compra
        atualizacao.projeto_fatura = item.projeto_fatura
      }

      console.log(
        `[conciliacao] conciliado (match nome+data+valor, origem=${origem}) desc="${item.descricao}" data=${item.data_compra} valor=${item.valor}` +
        (faturaMudou ? ` | fatura corrigida: ${match.projeto_fatura} → ${item.projeto_fatura} (data ${match.data_compra} → ${item.data_compra})` : '')
      )
      await atualizarRegistroConciliado(supabase, match.id, atualizacao)
      if (contexto) {
        atualizarCandidato(contexto, cartao, match.id, {
          status: 'CONCILIADO',
          valor_final: item.valor,
          ...(faturaMudou ? { data_compra: item.data_compra, projeto_fatura: item.projeto_fatura } : {}),
        })
      }
      return {
        acao: 'conciliado',
        inseriu: false,
        matchExistenteId: match.id,
        transacaoId: match.id,
        estadoAnterior: {
          status: match.status,
          valor: match.valor,
          valor_final: match.valor_final,
          ...(faturaMudou ? { data_compra: match.data_compra, projeto_fatura: match.projeto_fatura } : {}),
        },
      }
    }

    // Match parcial: nome + data coincidem, mas valor difere > R$0,05
    // Acima de R$2,00 de diferença → nova compra direta, sem notificação
    if (diffValor > 2.00) {
      const payload = buildPayload(item, { status: 'PENDENTE' })
      const { id, ok } = await inserirRegistro(supabase, payload)
      if (ok && id && contexto) {
        contexto.hashIndex.set(item.hash_linha, { id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'PENDENTE' })
        adicionarCandidato(contexto, cartao, { id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'PENDENTE', valor_final: null, projeto_fatura: item.projeto_fatura })
      }
      return { acao: 'inserido', inseriu: ok, transacaoId: id }
    }

    // Entre R$0,05 e R$2,00 → só ignora se já existir um conflito pendente para este original
    // COM O MESMO VALOR (reimportação da mesma linha, cujo valor "pendente" do Nubank varia até
    // fechar fatura). Um valor diferente é uma compra distinta e deve gerar seu próprio conflito,
    // em vez de ser descartada silenciosamente.
    // Caso raro (só quando há um conflito de valor de fato) — mantido como query direta ao
    // banco, sem batching: não compensa complexidade adicional para um caminho pouco frequente.
    const { data: conflitosExistentes } = await supabase
      .from('transacoes_nubank')
      .select('id, valor')
      .eq('conciliacao_ref', match.id)
      .eq('status', 'CONFLITO_VALOR')

    const conflitoMesmoValor = (conflitosExistentes ?? []).find(
      c => Math.abs(c.valor - item.valor) <= 0.05
    )

    if (conflitoMesmoValor) {
      console.log(`[conciliacao] conflito já pendente com mesmo valor para original=${match.id}, ignorando reimportação desc="${item.descricao}"`)
      return {
        acao: 'ignorado',
        inseriu: false,
        matchExistenteId: conflitoMesmoValor.id,
        registroConflitante: { id: match.id, descricao: match.descricao, valor: match.valor, data_compra: match.data_compra, status: match.status },
      }
    }

    const payload = buildPayload(item, { status: 'CONFLITO_VALOR', conciliacao_ref: match.id })
    const { id: conflito_id, ok } = await inserirRegistro(supabase, payload)
    if (!ok) return { acao: 'ignorado', inseriu: false }

    // CONFLITO_VALOR fica de fora de candidatosPorCartao propositalmente: a query original
    // já excluía esse status do match (.neq('status', 'CONFLITO_VALOR')), então este registro
    // não deve ser candidato de match para os próximos itens do lote.
    if (conflito_id && contexto) {
      contexto.hashIndex.set(item.hash_linha, { id: conflito_id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'CONFLITO_VALOR' })
    }

    let notificacaoId: string | null = null
    if (conflito_id) {
      notificacaoId = await criarNotificacaoConflito(supabase, match, item, conflito_id)
    }
    return {
      acao: 'conflito',
      inseriu: true,
      transacaoId: conflito_id,
      notificacaoId,
      registroConflitante: { id: match.id, descricao: match.descricao, valor: match.valor, data_compra: match.data_compra, status: match.status },
    }
  }

  // 3. Sem match: insere como PENDENTE
  const payload = buildPayload(item, { status: 'PENDENTE' })
  const { id, ok } = await inserirRegistro(supabase, payload)
  if (ok && id && contexto) {
    contexto.hashIndex.set(item.hash_linha, { id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'PENDENTE' })
    adicionarCandidato(contexto, cartao, { id, descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, status: 'PENDENTE', valor_final: null, projeto_fatura: item.projeto_fatura })
  }
  return { acao: 'inserido', inseriu: ok, transacaoId: id }
}
