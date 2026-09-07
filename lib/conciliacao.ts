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
 * query por transação) os dados necessários para decidir cada linha — dedupe por
 * hash e candidatos de match por nome+data. É atualizado em memória a cada
 * inserção/atualização PLANEJADA, para que o item N "enxergue" os efeitos dos
 * itens 1..N-1 do mesmo lote (read-after-write) sem nenhum round-trip de rede no
 * meio do caminho — as escritas de fato acontecem depois, em lote (ver
 * conciliarLote).
 */
interface ContextoConciliacao {
  hashIndex: Map<string, RegistroConflitante>
  candidatosPorCartao: Map<string, TransacaoMatch[]>
}

interface ContextoEstorno {
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
async function construirContextoConciliacao(
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
async function construirContextoEstornos(
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

/** Aplica o mesmo patch a vários registros em um único UPDATE. */
async function atualizarRegistros(
  supabase: SupabaseClient,
  ids: string[],
  payload: Record<string, unknown>
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('transacoes_nubank').update(payload).in('id', ids)
  if (error?.message?.includes('data_compra') && 'data_compra' in payload) {
    const { data_compra, ...resto } = payload
    await supabase.from('transacoes_nubank').update({ ...resto, data: data_compra }).in('id', ids)
  }
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
 * A busca no banco é feita em UMA query cobrindo todas as combinações
 * (cartão, total_parcelas) presentes no lote; o casamento por descrição é feito em
 * memória, com índices pré-calculados (`cartao|total|descricao-sem-parcela`), em vez
 * de renormalizar todas as descrições do lote para cada item.
 */
export async function aplicarResponsavelDeParcelaAnterior(
  supabase: SupabaseClient,
  transacoes: TransacaoNubank[]
): Promise<void> {
  const candidatasParceladas = transacoes.filter(
    item => !item.is_estorno && item.total_parcelas && item.parcela_atual && item.parcela_atual > 1
  )
  if (candidatasParceladas.length === 0) return

  const cartoes = [...new Set(candidatasParceladas.map(i => i.cartao ?? 'nubank'))]
  const totais = [...new Set(candidatasParceladas.map(i => i.total_parcelas!))]

  // Superconjunto das combinações necessárias (produto cartões × totais): o
  // agrupamento por chave abaixo descarta o que sobrar, e uma query só evita
  // N round-trips para N combinações.
  const { data: registrosBanco } = await supabase
    .from('transacoes_nubank')
    .select('descricao, responsavel, parcela_atual, cartao, total_parcelas')
    .in('cartao', cartoes)
    .in('total_parcelas', totais)
    .eq('is_estorno', false)
    .order('parcela_atual', { ascending: false })

  type RegistroParcela = { descricao: string; responsavel: string | null; parcela_atual: number }
  const parcelasNoBanco = new Map<string, RegistroParcela[]>()
  for (const row of (registrosBanco ?? []) as Array<RegistroParcela & { cartao: string | null; total_parcelas: number }>) {
    const chave = `${row.cartao ?? 'nubank'}|${row.total_parcelas}|${normalizarDescricaoSemParcela(row.descricao)}`
    const lista = parcelasNoBanco.get(chave)
    if (lista) lista.push(row)
    else parcelasNoBanco.set(chave, [row])
  }

  // Índice das parcelas do próprio lote, já ordenadas da maior para a menor —
  // mesma ordem de preferência do `.sort()` que era refeito por item.
  const parcelasNoLote = new Map<string, TransacaoNubank[]>()
  for (const t of transacoes) {
    if (t.is_estorno || !t.total_parcelas || !t.parcela_atual) continue
    const chave = `${t.cartao ?? 'nubank'}|${t.total_parcelas}|${normalizarDescricaoSemParcela(t.descricao)}`
    const lista = parcelasNoLote.get(chave)
    if (lista) lista.push(t)
    else parcelasNoLote.set(chave, [t])
  }
  for (const lista of parcelasNoLote.values()) {
    lista.sort((a, b) => (b.parcela_atual ?? 0) - (a.parcela_atual ?? 0))
  }

  for (const item of candidatasParceladas) {
    const chave = `${item.cartao ?? 'nubank'}|${item.total_parcelas}|${normalizarDescricaoSemParcela(item.descricao)}`

    const candidatoNoLote = (parcelasNoLote.get(chave) ?? []).find(
      t => t !== item && (t.parcela_atual ?? 0) < item.parcela_atual!
    )

    const responsavelAnterior = candidatoNoLote
      ? candidatoNoLote.responsavel
      : ((parcelasNoBanco.get(chave) ?? []).find(r => r.parcela_atual < item.parcela_atual!)?.responsavel as
          | 'Matheus'
          | 'Jeniffer'
          | 'Conjunto'
          | undefined) ?? null

    if (responsavelAnterior) item.responsavel = responsavelAnterior
  }
}

// ============================================================================
// Escrita em lote
// ----------------------------------------------------------------------------
// A decisão de cada linha (dedupe por hash, match nome+data, conflito de valor)
// é 100% em memória, sobre o contexto pré-carregado. O que sobrava de lento era
// a ESCRITA: um INSERT/UPDATE por linha, um de cada vez, cada um custando um
// round-trip até o Supabase — é isso que fazia um arquivo de poucas centenas de
// linhas levar de 30s a 1min. Agora o lote inteiro é planejado primeiro e as
// escritas são agrupadas: um punhado de comandos em vez de N.
// ============================================================================

/** Prefixo dos ids provisórios de linhas que ainda não foram inseridas. */
const REF_PENDENTE = '__pendente:'

interface InsercaoPendente {
  /** id provisório usado no contexto em memória até o insert acontecer */
  ref: string
  payload: Record<string, unknown>
  /** id real, preenchido na fase de escrita (null quando a linha não foi inserida) */
  id: string | null
  inseriu: boolean
}

interface PlanoLote {
  /** linhas que vão no INSERT em lote */
  insercoes: InsercaoPendente[]
  proximoRef: number
}

function novoPlano(): PlanoLote {
  return { insercoes: [], proximoRef: 0 }
}

function novaPendencia(
  plano: PlanoLote,
  payload: Record<string, unknown>,
  emLote: boolean
): InsercaoPendente {
  const pendencia: InsercaoPendente = { ref: `${REF_PENDENTE}${plano.proximoRef++}`, payload, id: null, inseriu: false }
  if (emLote) plano.insercoes.push(pendencia)
  return pendencia
}

/** Traduz um id provisório para o id real; ids já reais passam intactos. */
function resolverId(id: string | null | undefined, idPorRef: Map<string, string | null>): string | null {
  if (!id) return null
  return id.startsWith(REF_PENDENTE) ? idPorRef.get(id) ?? null : id
}

/** PostgREST exige que todos os objetos de um insert em lote tenham as mesmas chaves. */
function uniformizarPayloads(payloads: Record<string, unknown>[]): Record<string, unknown>[] {
  const chaves = new Set<string>()
  for (const p of payloads) for (const k of Object.keys(p)) chaves.add(k)
  return payloads.map(p => {
    const completo: Record<string, unknown> = {}
    for (const k of chaves) completo[k] = k in p ? p[k] : null
    return completo
  })
}

const TAMANHO_LOTE_INSERT = 500
const PARALELISMO_ESCRITA = 8

/** Executa `fn` sobre todos os itens, com no máximo `limite` chamadas em voo. */
async function emParalelo<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < itens.length; i += limite) {
    await Promise.all(itens.slice(i, i + limite).map(fn))
  }
}

type LinhaInserida = { id: string; hash_linha: string }

/**
 * Insere as linhas planejadas em poucos INSERTs em lote. `ON CONFLICT (hash_linha)
 * DO NOTHING` (upsert com ignoreDuplicates) reproduz exatamente a deduplicação que o
 * insert individual obtinha via erro 23505: as linhas devolvidas pelo `.select()` são
 * as que foram de fato inseridas; as que não voltam já existiam.
 *
 * Qualquer outra falha no lote cai de volta para o insert linha a linha, preservando
 * o comportamento antigo (inclusive o throw em erro que não seja de duplicata).
 */
async function executarInsercoes(supabase: SupabaseClient, pendencias: InsercaoPendente[]): Promise<void> {
  for (let i = 0; i < pendencias.length; i += TAMANHO_LOTE_INSERT) {
    await inserirLote(supabase, pendencias.slice(i, i + TAMANHO_LOTE_INSERT))
  }
}

async function inserirLote(supabase: SupabaseClient, lote: InsercaoPendente[]): Promise<void> {
  if (lote.length === 0) return

  const resposta = await supabase
    .from('transacoes_nubank')
    .upsert(uniformizarPayloads(lote.map(p => p.payload)), { onConflict: 'hash_linha', ignoreDuplicates: true })
    .select('id, hash_linha')

  let linhas = resposta.data as LinhaInserida[] | null
  let erro = resposta.error as { message?: string } | null

  // Fallback para schema legado (coluna 'data' em vez de 'data_compra')
  if (erro?.message?.includes('data_compra')) {
    const legado = lote.map(p => {
      const { data_compra, ...resto } = p.payload
      return { ...resto, data: data_compra }
    })
    const respostaLegado = await supabase
      .from('transacoes_nubank')
      .upsert(uniformizarPayloads(legado), { onConflict: 'hash_linha', ignoreDuplicates: true })
      .select('id, hash_linha')
    linhas = respostaLegado.data as LinhaInserida[] | null
    erro = respostaLegado.error as { message?: string } | null
  }

  if (erro) {
    console.error('[conciliacao] insert em lote falhou, refazendo linha a linha:', erro.message)
    for (const pendencia of lote) {
      const { id, ok } = await inserirRegistro(supabase, pendencia.payload)
      pendencia.id = id
      pendencia.inseriu = ok
    }
    return
  }

  const idPorHash = new Map((linhas ?? []).map(r => [r.hash_linha, r.id]))
  for (const pendencia of lote) {
    const id = idPorHash.get(pendencia.payload.hash_linha as string) ?? null
    pendencia.id = id
    pendencia.inseriu = id !== null
  }
}

/** Agrupa os UPDATEs por patch idêntico (1 comando por patch) e roda os grupos em paralelo. */
async function executarAtualizacoes(
  supabase: SupabaseClient,
  atualizacoes: Array<{ id: string; patch: Record<string, unknown> }>
): Promise<void> {
  const grupos = new Map<string, { patch: Record<string, unknown>; ids: string[] }>()
  for (const { id, patch } of atualizacoes) {
    const chave = JSON.stringify(patch)
    const grupo = grupos.get(chave)
    if (grupo) grupo.ids.push(id)
    else grupos.set(chave, { patch, ids: [id] })
  }
  await emParalelo([...grupos.values()], PARALELISMO_ESCRITA, g => atualizarRegistros(supabase, g.ids, g.patch))
}

/**
 * Conflitos de valor já registrados e ainda não resolvidos (status CONFLITO_VALOR),
 * indexados pela transação original que eles referenciam. Substitui a query
 * `.eq('conciliacao_ref', match.id)` que era feita por linha no caminho de conflito.
 * São poucos registros no total (um conflito só existe até o usuário resolvê-lo),
 * então carregar todos de uma vez é mais barato que uma query por ocorrência.
 */
async function carregarConflitosPendentes(
  supabase: SupabaseClient
): Promise<Map<string, Array<{ id: string; valor: number }>>> {
  const porOriginal = new Map<string, Array<{ id: string; valor: number }>>()
  const { data } = await supabase
    .from('transacoes_nubank')
    .select('id, valor, conciliacao_ref')
    .eq('status', 'CONFLITO_VALOR')
    .not('conciliacao_ref', 'is', null)

  for (const row of (data ?? []) as Array<{ id: string; valor: number; conciliacao_ref: string }>) {
    const lista = porOriginal.get(row.conciliacao_ref)
    if (lista) lista.push({ id: row.id, valor: row.valor })
    else porOriginal.set(row.conciliacao_ref, [{ id: row.id, valor: row.valor }])
  }
  return porOriginal
}

// ============================================================================
// Planejamento (síncrono) das compras normais
// ============================================================================

type PlanoTransacao =
  | { tipo: 'final'; resultado: ResultadoConciliacao }
  | { tipo: 'inserir'; pendencia: InsercaoPendente; resultado: ResultadoConciliacao }
  | { tipo: 'atualizar'; alvo: string; patch: Record<string, unknown>; resultado: ResultadoConciliacao }
  | {
      tipo: 'conflito'
      item: TransacaoNubank
      match: TransacaoMatch
      pendencia: InsercaoPendente
      resultado: ResultadoConciliacao
    }

function planejarInsercaoPendente(
  item: TransacaoNubank,
  contexto: ContextoConciliacao,
  plano: PlanoLote
): PlanoTransacao {
  const cartao = item.cartao ?? 'nubank'
  const pendencia = novaPendencia(plano, buildPayload(item, { status: 'PENDENTE' }), true)

  // O contexto passa a enxergar a linha como se já existisse (o insert é garantido
  // logo em seguida) — é o que dá aos próximos itens do lote a mesma visão
  // "read-after-write" que o insert por linha oferecia.
  contexto.hashIndex.set(item.hash_linha, {
    id: pendencia.ref,
    descricao: item.descricao,
    valor: item.valor,
    data_compra: item.data_compra,
    status: 'PENDENTE',
  })
  adicionarCandidato(contexto, cartao, {
    id: pendencia.ref,
    descricao: item.descricao,
    valor: item.valor,
    data_compra: item.data_compra,
    status: 'PENDENTE',
    valor_final: null,
    projeto_fatura: item.projeto_fatura,
  })

  return { tipo: 'inserir', pendencia, resultado: { acao: 'inserido', inseriu: true, transacaoId: pendencia.ref } }
}

/**
 * Decide o destino de UMA compra normal, sem tocar no banco: devolve o resultado e a
 * escrita que ele exige. É a mesma árvore de decisão de sempre (hash → match
 * nome+data → tolerância de valor), só que resolvida inteiramente sobre o contexto
 * pré-carregado.
 */
function planejarTransacao(
  item: TransacaoNubank,
  origem: OrigemImportacao,
  contexto: ContextoConciliacao,
  conflitosPorOriginal: Map<string, Array<{ id: string; valor: number }>>,
  plano: PlanoLote
): PlanoTransacao {
  // occurrence_index indica a Nª ocorrência desta combinação (data|desc|valor) no lote.
  // Valor 1 é o caso normal (retrocompatível); >1 significa compra legítima repetida.
  const occurrenceIndex = (item as TransacaoNubank & { occurrence_index?: number }).occurrence_index ?? 1
  const cartao = item.cartao ?? 'nubank'

  // 1. Hash pre-check: se o hash já existe, é reimportação desta linha exata → ignora
  const hashMatch = contexto.hashIndex.get(item.hash_linha) ?? null
  if (hashMatch) {
    console.log(`[conciliacao] ignorado (hash duplicado) hash=${item.hash_linha.slice(0, 12)} desc="${item.descricao}" data=${item.data_compra} valor=${item.valor}`)
    return {
      tipo: 'final',
      resultado: { acao: 'ignorado', inseriu: false, matchExistenteId: hashMatch.id, registroConflitante: hashMatch },
    }
  }

  // 2. Buscar match por nome (LOWER estrito) + data (±3 dias)
  const matches = buscarMatchNomeDataEmContexto(contexto, item)

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
        return planejarInsercaoPendente(item, contexto, plano)
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

      const estadoAnterior = {
        status: match.status,
        valor: match.valor,
        valor_final: match.valor_final,
        ...(faturaMudou ? { data_compra: match.data_compra, projeto_fatura: match.projeto_fatura } : {}),
      }

      atualizarCandidato(contexto, cartao, match.id, {
        status: 'CONCILIADO',
        valor_final: item.valor,
        ...(faturaMudou ? { data_compra: item.data_compra, projeto_fatura: item.projeto_fatura } : {}),
      })

      const resultado: ResultadoConciliacao = {
        acao: 'conciliado',
        inseriu: false,
        matchExistenteId: match.id,
        transacaoId: match.id,
        estadoAnterior,
      }

      // O registro já está exatamente como o UPDATE o deixaria (reimportação do mesmo
      // extrato, o caso mais comum): a linha continua "conciliada" para efeito de
      // relatório, mas sem gastar um round-trip para reescrever os mesmos valores.
      // A tabela não tem trigger nem coluna de atualização, então o estado final é
      // idêntico com ou sem esse UPDATE.
      const jaEstaAssim = !faturaMudou && match.status === 'CONCILIADO' && match.valor_final === item.valor
      if (jaEstaAssim) return { tipo: 'final', resultado }

      return { tipo: 'atualizar', alvo: match.id, patch: atualizacao, resultado }
    }

    // Match parcial: nome + data coincidem, mas valor difere > R$0,05
    // Acima de R$2,00 de diferença → nova compra direta, sem notificação
    if (diffValor > 2.00) {
      return planejarInsercaoPendente(item, contexto, plano)
    }

    // Entre R$0,05 e R$2,00 → só ignora se já existir um conflito pendente para este original
    // COM O MESMO VALOR (reimportação da mesma linha, cujo valor "pendente" do Nubank varia até
    // fechar fatura). Um valor diferente é uma compra distinta e deve gerar seu próprio conflito,
    // em vez de ser descartada silenciosamente.
    const conflitosExistentes = conflitosPorOriginal.get(match.id) ?? []
    const conflitoMesmoValor = conflitosExistentes.find(c => Math.abs(c.valor - item.valor) <= 0.05)

    if (conflitoMesmoValor) {
      console.log(`[conciliacao] conflito já pendente com mesmo valor para original=${match.id}, ignorando reimportação desc="${item.descricao}"`)
      return {
        tipo: 'final',
        resultado: {
          acao: 'ignorado',
          inseriu: false,
          matchExistenteId: conflitoMesmoValor.id,
          registroConflitante: { id: match.id, descricao: match.descricao, valor: match.valor, data_compra: match.data_compra, status: match.status },
        },
      }
    }

    // Conflito de valor fica FORA do insert em lote: a tabela tem um índice único
    // parcial (idx_transacoes_conciliacao_ref_pendente) que só permite 1 conflito
    // aberto por transação original, e uma violação dele abortaria o lote inteiro.
    // São poucas linhas por importação, então o insert individual (que trata a
    // violação como "ignorado") continua valendo a pena aqui.
    const pendencia = novaPendencia(plano, buildPayload(item, { status: 'CONFLITO_VALOR', conciliacao_ref: match.id }), false)

    // CONFLITO_VALOR fica de fora de candidatosPorCartao propositalmente: a query original
    // já excluía esse status do match (.neq('status', 'CONFLITO_VALOR')), então este registro
    // não deve ser candidato de match para os próximos itens do lote.
    contexto.hashIndex.set(item.hash_linha, {
      id: pendencia.ref,
      descricao: item.descricao,
      valor: item.valor,
      data_compra: item.data_compra,
      status: 'CONFLITO_VALOR',
    })
    conflitosPorOriginal.set(match.id, [...conflitosExistentes, { id: pendencia.ref, valor: item.valor }])

    return {
      tipo: 'conflito',
      item,
      match,
      pendencia,
      resultado: {
        acao: 'conflito',
        inseriu: true,
        transacaoId: pendencia.ref,
        notificacaoId: null,
        registroConflitante: { id: match.id, descricao: match.descricao, valor: match.valor, data_compra: match.data_compra, status: match.status },
      },
    }
  }

  // 3. Sem match: insere como PENDENTE
  return planejarInsercaoPendente(item, contexto, plano)
}

/**
 * Concilia todas as compras normais de uma importação de uma vez.
 *
 * Substitui o antigo laço `for (item of itens) await conciliarTransacao(...)`, que
 * fazia uma escrita por linha, uma de cada vez. Aqui as decisões (idênticas às de
 * antes, na mesma ordem) são todas tomadas em memória sobre o contexto pré-carregado
 * e só então as escritas acontecem, agrupadas: um INSERT em lote para as compras
 * novas, um UPDATE por patch distinto para as conciliadas, e o caminho individual
 * apenas para os raros conflitos de valor.
 *
 * Devolve um resultado por transação, na MESMA ordem da entrada.
 */
export async function conciliarLote(
  supabase: SupabaseClient,
  transacoesNormais: TransacaoNubank[],
  origem: OrigemImportacao
): Promise<ResultadoConciliacao[]> {
  if (transacoesNormais.length === 0) return []

  const [contexto, conflitosPorOriginal] = await Promise.all([
    construirContextoConciliacao(supabase, transacoesNormais),
    carregarConflitosPendentes(supabase),
  ])

  const plano = novoPlano()
  const planos = transacoesNormais.map(item =>
    planejarTransacao(item, origem, contexto, conflitosPorOriginal, plano)
  )

  // 1. Compras novas — um INSERT em lote.
  await executarInsercoes(supabase, plano.insercoes)
  const idPorRef = new Map<string, string | null>(plano.insercoes.map(p => [p.ref, p.id]))

  for (const p of planos) {
    if (p.tipo !== 'inserir') continue
    p.resultado.inseriu = p.pendencia.inseriu
    p.resultado.transacaoId = p.pendencia.id
  }

  // 2. Conflitos de valor — individuais (índice único parcial no banco), depois dos
  //    inserts para que um conflito contra uma compra recém-inserida no mesmo lote
  //    já tenha o id real dela em conciliacao_ref.
  const conflitosInseridos: ConflitoNotificavel[] = []
  for (const p of planos) {
    if (p.tipo !== 'conflito') continue

    // A compra original só não tem id real se ela mesma era uma inserção deste lote
    // que o banco recusou — aí não há o que referenciar e a linha é descartada.
    const idOriginal = resolverId(p.pendencia.payload.conciliacao_ref as string, idPorRef)
    p.pendencia.payload.conciliacao_ref = idOriginal

    const { id: conflitoId, ok } = idOriginal
      ? await inserirRegistro(supabase, p.pendencia.payload)
      : { id: null as string | null, ok: false }

    p.pendencia.id = conflitoId
    p.pendencia.inseriu = ok
    idPorRef.set(p.pendencia.ref, conflitoId)

    // Recusado pelo índice único parcial (já existe conflito aberto para essa
    // original): mesma saída do caminho antigo — nada registrado, linha ignorada.
    if (!idOriginal || !ok || !conflitoId) {
      p.resultado.acao = 'ignorado'
      p.resultado.inseriu = false
      p.resultado.transacaoId = undefined
      p.resultado.notificacaoId = undefined
      p.resultado.registroConflitante = undefined
      continue
    }

    p.resultado.transacaoId = conflitoId
    conflitosInseridos.push({ resultado: p.resultado, match: p.match, originalId: idOriginal, item: p.item, conflitoId })
  }

  // 3. Conciliações — UPDATEs agrupados, em paralelo.
  const atualizacoes: Array<{ id: string; patch: Record<string, unknown> }> = []
  for (const p of planos) {
    if (p.tipo !== 'atualizar') continue
    const alvo = resolverId(p.alvo, idPorRef)
    if (!alvo) continue
    atualizacoes.push({ id: alvo, patch: p.patch })
  }

  await Promise.all([
    executarAtualizacoes(supabase, atualizacoes),
    criarNotificacoesConflito(supabase, conflitosInseridos),
  ])

  // 4. Troca os ids provisórios que sobraram nos resultados pelos ids reais.
  for (const p of planos) resolverIdsDoResultado(p.resultado, idPorRef)

  return planos.map(p => p.resultado)
}

function resolverIdsDoResultado(resultado: ResultadoConciliacao, idPorRef: Map<string, string | null>): void {
  if (resultado.transacaoId?.startsWith(REF_PENDENTE)) {
    resultado.transacaoId = resolverId(resultado.transacaoId, idPorRef)
  }
  if (resultado.matchExistenteId?.startsWith(REF_PENDENTE)) {
    resultado.matchExistenteId = resolverId(resultado.matchExistenteId, idPorRef)
  }
  if (resultado.registroConflitante?.id?.startsWith(REF_PENDENTE)) {
    const id = resolverId(resultado.registroConflitante.id, idPorRef)
    resultado.registroConflitante = id ? { ...resultado.registroConflitante, id } : null
  }
}

/**
 * Cria, em um único INSERT, as notificações in-app dos conflitos de valor do lote.
 * O id de cada notificação volta pelo `conflito_id` gravado em metadata (e não pela
 * ordem das linhas), para que cada resultado receba exatamente o seu.
 */
interface ConflitoNotificavel {
  resultado: ResultadoConciliacao
  match: TransacaoMatch
  /** id real da compra original (o de `match` pode ser provisório, de uma linha inserida neste mesmo lote) */
  originalId: string
  item: TransacaoNubank
  conflitoId: string
}

async function criarNotificacoesConflito(
  supabase: SupabaseClient,
  conflitos: ConflitoNotificavel[]
): Promise<void> {
  if (conflitos.length === 0) return

  const { data } = await supabase
    .from('notificacoes')
    .insert(conflitos.map(({ match, originalId, item, conflitoId }) => ({
      de_usuario: 'sistema',
      nome_usuario: 'Sistema',
      acao: 'conciliacao_conflito',
      descricao: `Conflito de valor em "${item.descricao}": ${formatBRL(match.valor)} → ${formatBRL(item.valor)}`,
      valor: item.valor,
      metadata: {
        original_id: originalId,
        conflito_id: conflitoId,
        valor_original: match.valor,
        valor_novo: item.valor,
        descricao: item.descricao,
        data_compra: item.data_compra,
      },
    })))
    .select('id, metadata')

  const idPorConflito = new Map<string, string>(
    ((data ?? []) as Array<{ id: string; metadata: { conflito_id?: string } }>)
      .filter(n => !!n.metadata?.conflito_id)
      .map(n => [n.metadata.conflito_id as string, n.id])
  )

  for (const { resultado, conflitoId } of conflitos) {
    resultado.notificacaoId = idPorConflito.get(conflitoId) ?? null
  }
}

// ============================================================================
// Estornos
// ============================================================================

interface PlanoEstorno {
  estorno: TransacaoNubank
  pendencia: InsercaoPendente | null
  original: RegistroConflitante | null
  resultado: ResultadoEstorno
}

/**
 * Decide o destino de UM estorno sem tocar no banco (mesma lógica de sempre:
 * dedupe por hash → busca da compra original pela descrição normalizada dentro de
 * ±30 dias e R$ 0,05).
 */
function planejarEstorno(
  estorno: TransacaoNubank,
  contexto: ContextoEstorno,
  plano: PlanoLote
): PlanoEstorno {
  const cartaoEstorno = estorno.cartao ?? 'nubank'

  // 1. Hash dedup — evita reprocessar o mesmo estorno em reimportação
  const hashMatch = contexto.hashIndex.get(estorno.hash_linha) ?? null
  if (hashMatch) {
    console.log(`[conciliacao] estorno ignorado (hash duplicado) hash=${estorno.hash_linha.slice(0, 12)} desc="${estorno.descricao}"`)
    return { estorno, pendencia: null, original: null, resultado: { acao: 'ignorado', inseriu: false, registroConflitante: hashMatch } }
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

  const candidatos = contexto.candidatosPorCartao.get(cartaoEstorno) ?? []
  const original = candidatos.find(c =>
    c.data_compra >= dataInicio &&
    c.data_compra <= dataFim &&
    normalizarDescricaoParaHash(c.descricao) === descOriginal &&
    Math.abs(c.valor - estorno.valor) <= 0.05
  ) ?? null

  // 3. Planeja o registro do estorno
  const { occurrence_index: _oi, ...base } = estorno as TransacaoNubank & { occurrence_index?: number }
  const pendencia = novaPendencia(plano, {
    ...base,
    status: 'ESTORNO',
    is_estorno: true,
    conciliacao_ref: original?.id ?? null,
  }, true)

  contexto.hashIndex.set(estorno.hash_linha, {
    id: pendencia.ref,
    descricao: estorno.descricao,
    valor: estorno.valor,
    data_compra: estorno.data_compra,
    status: 'ESTORNO',
  })

  if (original) {
    atualizarCandidatoEstorno(contexto, cartaoEstorno, original.id, { status: 'ESTORNADO' })
    console.log(`[conciliacao] estorno aplicado → original id=${original.id} desc="${original.descricao}"`)
    return {
      estorno,
      pendencia,
      original,
      resultado: {
        acao: 'aplicado',
        inseriu: true,
        transacaoId: pendencia.ref,
        originalId: original.id,
        statusAnteriorOriginal: original.status,
      },
    }
  }

  console.log(`[conciliacao] estorno registrado sem match desc="${estorno.descricao}" data=${estorno.data_compra}`)
  return {
    estorno,
    pendencia,
    original: null,
    resultado: { acao: 'registrado', inseriu: true, transacaoId: pendencia.ref, originalId: null, statusAnteriorOriginal: null },
  }
}

/**
 * Concilia todos os estornos de uma importação de uma vez — mesmo desenho de
 * conciliarLote(): decide tudo em memória e escreve em lote (1 INSERT para os
 * registros de estorno, 1 UPDATE marcando as compras originais como ESTORNADO e
 * 1 INSERT para as notificações).
 *
 * Precisa rodar DEPOIS de conciliarLote(): o contexto é montado a partir do banco
 * e deve enxergar as compras normais recém-importadas.
 *
 * Devolve um resultado por estorno, na MESMA ordem da entrada.
 */
export async function conciliarEstornosLote(
  supabase: SupabaseClient,
  estornos: TransacaoNubank[]
): Promise<ResultadoEstorno[]> {
  if (estornos.length === 0) return []

  const contexto = await construirContextoEstornos(supabase, estornos)
  const plano = novoPlano()
  const planos = estornos.map(estorno => planejarEstorno(estorno, contexto, plano))

  await executarInsercoes(supabase, plano.insercoes)

  const idsOriginais: string[] = []
  const notificacoes: Record<string, unknown>[] = []

  for (const p of planos) {
    if (!p.pendencia) continue

    // Insert recusado = hash duplicado (dois estornos idênticos no mesmo arquivo):
    // nada é registrado e a compra original não é marcada, igual ao caminho antigo.
    if (!p.pendencia.inseriu) {
      p.resultado = { acao: 'ignorado', inseriu: false }
      continue
    }

    p.resultado.transacaoId = p.pendencia.id

    if (p.original) {
      idsOriginais.push(p.original.id)
      notificacoes.push({
        de_usuario: 'sistema',
        nome_usuario: 'Sistema',
        acao: 'estorno_aplicado',
        descricao: `Estorno detectado em "${p.original.descricao}": ${formatBRL(p.estorno.valor)} devolvido.`,
        valor: p.estorno.valor,
        metadata: {
          original_id: p.original.id,
          descricao: p.original.descricao,
          valor: p.estorno.valor,
          data_compra: p.estorno.data_compra,
        },
      })
    }
  }

  await Promise.all([
    atualizarRegistros(supabase, idsOriginais, { status: 'ESTORNADO' }),
    notificacoes.length > 0
      ? supabase.from('notificacoes').insert(notificacoes).then(() => undefined)
      : Promise.resolve(),
  ])

  const idPorRef = new Map<string, string | null>(plano.insercoes.map(p => [p.ref, p.id]))
  for (const p of planos) {
    const registro = p.resultado.registroConflitante
    if (registro?.id?.startsWith(REF_PENDENTE)) {
      const id = resolverId(registro.id, idPorRef)
      p.resultado.registroConflitante = id ? { ...registro, id } : null
    }
  }

  return planos.map(p => p.resultado)
}
