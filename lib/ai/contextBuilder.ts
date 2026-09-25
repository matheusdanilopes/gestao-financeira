// Central AI Context Builder — assembles structured context for every AI request

import { format, subMonths, startOfMonth } from 'date-fns'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { agoraBrasil } from './tempo'
import type {
  EnrichedData,
  ItemListaCompras,
} from './types'

// ─── Per-user cache ───────────────────────────────────────────────────────────
// Keyed by userId to prevent data leakage between users.
// Serverless functions are ephemeral — this cache lives for the lifetime of a
// single function instance and is never shared across users or requests from
// different users in the same instance, because userId is always the key.

const _userCache = new Map<string, { data: EnrichedData; ts: number }>()
// Kept short on purpose: the AI must reflect changes made moments ago (new
// expense, payment, import) without serving a stale snapshot for minutes.
// A rota de chat também força a leitura fresca na primeira mensagem de cada
// conversa, então este TTL só limita o quanto o dado envelhece dentro de um
// mesmo turno de conversa.
const CACHE_TTL_MS = 60 * 1000
const MAX_CACHE_ENTRIES = 10 // prevent unbounded memory growth

// O PostgREST devolve no máximo 1000 linhas por select. Sem paginar, 24 meses
// de compras de três cartões perdiam os meses mais antigos EM SILÊNCIO — e o
// mês da borda chegava pela metade, com cara de mês completo.
const TAMANHO_PAGINA = 1000
const MAX_PAGINAS = 30

/** Falha ao carregar uma fonte sem a qual a análise ficaria errada (compras, planejamento). */
export class DadosIndisponiveisError extends Error {
  constructor(fonte: string, detalhe: string) {
    super(`Falha ao carregar ${fonte}: ${detalhe}`)
    this.name = 'DadosIndisponiveisError'
  }
}

// Só para chamadores sem sessão. O caminho normal é receber o cliente
// autenticado da rota: com a anon key "crua", nenhuma tabela protegida por RLS
// (ex.: limites_parcelamentos) é legível, e endurecer as políticas das tabelas
// financeiras deixaria o chat sem dados.
function getSupabaseAnon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
      'placeholder'
  )
}

type Resultado<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Busca todas as páginas de uma consulta. `montar` precisa ter ordenação estável. */
async function buscarTudo<T>(montar: (de: number, ate: number) => Resultado<T>): Promise<T[]> {
  const todas: T[] = []
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * TAMANHO_PAGINA
    const { data, error } = await montar(de, de + TAMANHO_PAGINA - 1)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    todas.push(...lote)
    if (lote.length < TAMANHO_PAGINA) break
  }
  return todas
}

export function clearEnrichedDataCache(userId: string): void {
  _userCache.delete(userId)
}

export async function fetchEnrichedData(
  userId: string,
  force = false,
  cliente?: SupabaseClient
): Promise<EnrichedData> {
  const now = Date.now()
  const cached = _userCache.get(userId)
  if (!force && cached && now - cached.ts < CACHE_TTL_MS) return cached.data

  // Evict oldest entry if cache is full, to prevent unbounded growth
  if (_userCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [..._userCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) _userCache.delete(oldest[0])
  }

  const supabase = cliente ?? getSupabaseAnon()
  const hoje = agoraBrasil()
  const limite = format(startOfMonth(subMonths(hoje, 24)), 'yyyy-MM-dd')

  // Estornos only need a short recent window — they're used to explain
  // why a bill differs from the raw sum of purchases, not for long-term history.
  const limiteEstornos = format(startOfMonth(subMonths(hoje, 3)), 'yyyy-MM-dd')

  const avisos: string[] = []

  /** Fonte obrigatória: sem ela a resposta sairia errada, então o turno falha com clareza. */
  const obrigatoria = async <T>(fonte: string, busca: () => Promise<T[]>): Promise<T[]> => {
    try { return await busca() }
    catch (err) { throw new DadosIndisponiveisError(fonte, err instanceof Error ? err.message : String(err)) }
  }
  /** Fonte secundária: a falha vira um aviso que o agente repassa, em vez de um "zero" mudo. */
  const opcional = async <T>(fonte: string, busca: () => Promise<T[]>): Promise<T[]> => {
    try { return await busca() }
    catch (err) {
      console.error(`[contextBuilder] ${fonte}:`, err instanceof Error ? err.message : err)
      avisos.push(`Não foi possível carregar ${fonte} agora — não afirme nada sobre isso como se fosse zero.`)
      return []
    }
  }

  const [
    transacoes,
    planejamento,
    configuracoes,
    assinaturas,
    investimentos,
    aportes,
    estornos,
    limites,
    recebimentos,
    faturas,
    desejos,
    mercado,
    listasCompras,
  ] = await Promise.all([
    // Transactions (last 24 months) — exclude reversed purchases and reversal entries
    obrigatoria('as compras de cartão', () => buscarTudo(async (de, ate) =>
      supabase
        .from('transacoes_nubank')
        .select('descricao,valor,responsavel,categoria,projeto_fatura,data,cartao,parcela_atual,total_parcelas')
        .gte('projeto_fatura', limite)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO')
        .order('projeto_fatura', { ascending: false })
        .order('id', { ascending: true })
        .range(de, ate)
    )),

    // Planning/budgets (includes [RECEITA]* rows — filtered by convention downstream)
    obrigatoria('o planejamento', () => buscarTudo(async (de, ate) =>
      supabase
        .from('planejamento')
        .select('id,item,responsavel,valor_previsto,categoria,mes_referencia,parcela_atual,total_parcelas,data_vencimento,data_pagamento,valor_real,pago')
        .gte('mes_referencia', limite)
        .order('mes_referencia', { ascending: false })
        .order('id', { ascending: true })
        .range(de, ate)
    )),

    opcional('as configurações', async () => {
      const { data, error } = await supabase.from('configuracoes').select('chave,valor')
      if (error) throw new Error(error.message)
      return data ?? []
    }),

    opcional('as assinaturas', async () => {
      const r = await supabase
        .from('assinaturas')
        .select('nome,valor,cartao,responsavel,categoria,ativa,dia_cobranca,pausada_ate')
        .order('valor', { ascending: false })
      // Instâncias sem a migração de pausa: repete sem a coluna em vez de perder tudo.
      if (r.error?.message?.includes('pausada_ate')) {
        const legado = await supabase
          .from('assinaturas')
          .select('nome,valor,cartao,responsavel,categoria,ativa,dia_cobranca')
          .order('valor', { ascending: false })
        if (legado.error) throw new Error(legado.error.message)
        return legado.data ?? []
      }
      if (r.error) throw new Error(r.error.message)
      return r.data ?? []
    }),

    opcional('os investimentos', async () => {
      const { data, error } = await supabase
        .from('investimentos')
        .select('id,descricao,percentual,mes_referencia')
        .order('mes_referencia', { ascending: false })
      if (error) throw new Error(error.message)
      return data ?? []
    }),

    // Todos os aportes: um teto de 100 fazia o "total investido" parar de crescer.
    // saldo_atual é o saldo que o usuário informa ao registrar o aporte — a única
    // fonte de "quanto tenho investido" que o app tem.
    opcional('os aportes de investimento', async () => {
      const aportes = (colunas: string) => buscarTudo(async (de, ate) =>
        supabase
          .from('investimentos_aportes')
          .select(colunas)
          .order('data_aporte', { ascending: false })
          .order('id', { ascending: true })
          .range(de, ate)
      )
      try {
        return await aportes('investimento_id,valor,data_aporte,observacao,saldo_atual')
      } catch (err) {
        if (!(err instanceof Error && err.message.includes('saldo_atual'))) throw err
        return await aportes('investimento_id,valor,data_aporte,observacao')
      }
    }),

    // Estornos (reversals) — kept visible so the AI can explain adjustments
    // instead of silently working with a net figure it can't account for.
    opcional('os estornos', async () => {
      const { data, error } = await supabase
        .from('transacoes_nubank')
        .select('descricao,valor,data,cartao,projeto_fatura,status')
        .gte('projeto_fatura', limiteEstornos)
        .in('status', ['ESTORNO', 'ESTORNADO'])
        .order('data', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return data ?? []
    }),

    opcional('os limites de parcelamento', async () => {
      const { data, error } = await supabase
        .from('limites_parcelamentos')
        .select('mes_referencia,responsavel,valor')
        .order('mes_referencia', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map(l => ({ ...l, valor: Number(l.valor ?? 0) }))
    }),

    opcional('os recebimentos de receitas', () => buscarTudo(async (de, ate) =>
      supabase
        .from('receitas_recebimentos')
        .select('planejamento_id,valor,data_recebimento')
        .order('planejamento_id', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate)
    )),

    opcional('as datas de fechamento das faturas', async () => {
      const { data, error } = await supabase
        .from('faturas')
        .select('cartao,mes_referencia,data_fechamento')
        .gte('mes_referencia', limiteEstornos)
      if (error) throw new Error(error.message)
      return data ?? []
    }),

    opcional('a lista de desejos', async () => {
      const { data, error } = await supabase
        .from('wishlist_items')
        .select('nome,valor_estimado,prioridade,realizado,categoria,criado_por')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw new Error(error.message)
      return data ?? []
    }),

    opcional('a lista de mercado', async () => {
      const { data, error } = await supabase
        .from('lista_mercado_itens')
        .select('nome,quantidade,preco_unit,comprado')
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) throw new Error(error.message)
      return data ?? []
    }),

    opcional('as listas de compras', async () => {
      const { data: listas, error } = await supabase
        .from('listas_compras')
        .select('id,nome')
        .eq('status', 'ativa')
      if (error) throw new Error(error.message)
      if (!listas || listas.length === 0) return [] as ItemListaCompras[]
      const nomes = new Map(listas.map(l => [l.id as string, l.nome as string]))
      const { data: itens, error: erroItens } = await supabase
        .from('listas_compras_itens')
        .select('lista_id,nome,quantidade,pessoa,preco_previsto,preco_pago,status')
        .in('lista_id', [...nomes.keys()])
        .limit(1000)
      if (erroItens) throw new Error(erroItens.message)
      return (itens ?? []).map(i => ({
        lista: nomes.get(i.lista_id as string) ?? 'Lista',
        nome: i.nome,
        quantidade: i.quantidade,
        pessoa: i.pessoa,
        preco_previsto: i.preco_previsto,
        preco_pago: i.preco_pago,
        status: i.status,
      })) as ItemListaCompras[]
    }),
  ])

  const data: EnrichedData = {
    transacoes: transacoes as EnrichedData['transacoes'],
    planejamento: planejamento as EnrichedData['planejamento'],
    configuracoes: configuracoes as EnrichedData['configuracoes'],
    assinaturas: assinaturas as EnrichedData['assinaturas'],
    investimentos: investimentos as EnrichedData['investimentos'],
    aportes: aportes as unknown as EnrichedData['aportes'],
    estornos: estornos as EnrichedData['estornos'],
    limites: limites as EnrichedData['limites'],
    recebimentos: recebimentos as EnrichedData['recebimentos'],
    faturas: faturas as EnrichedData['faturas'],
    desejos: desejos as EnrichedData['desejos'],
    mercado: mercado as EnrichedData['mercado'],
    listasCompras: listasCompras as EnrichedData['listasCompras'],
    avisos,
    ts: now,
  }

  // Resultado com falha parcial não vai para o cache: a próxima mensagem tenta de novo.
  if (avisos.length === 0) _userCache.set(userId, { data, ts: now })
  return data
}
