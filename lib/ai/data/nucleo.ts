/**
 * Núcleo de dados do assessor: as fontes que o snapshot do prompt, a auditoria
 * e as ferramentas especializadas (queryEngine) leem em memória.
 *
 * Diferenças para o antigo contextBuilder:
 *  - Compras e planejamento são carregados numa JANELA QUENTE (24 meses) e o
 *    histórico anterior é buscado sob demanda (ver GatewayDados) — antes, o que
 *    ficava fora da janela simplesmente não existia para a IA.
 *  - Estornos vêm da mesma leitura das compras, sem o corte de 3 meses / 50
 *    linhas; datas de fechamento, desejos, mercado e listas não têm mais teto
 *    (e as listas de compras concluídas também entram).
 *  - Colunas que o app usa e a IA não enxergava: nome personalizado da compra,
 *    observações, moeda de origem da assinatura, saldo do investimento etc.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EnrichedData,
  Estorno,
  ItemListaCompras,
  Planejamento,
  Transacao,
} from '../types'
import { lerTabela, type FiltroBanco } from './leitura'

/** Falha ao carregar uma fonte sem a qual a análise ficaria errada (compras, planejamento). */
export class DadosIndisponiveisError extends Error {
  constructor(fonte: string, detalhe: string) {
    super(`Falha ao carregar ${fonte}: ${detalhe}`)
    this.name = 'DadosIndisponiveisError'
  }
}

const STATUS_ESTORNO = new Set(['ESTORNO', 'ESTORNADO'])

const COLUNAS_COMPRA = ['id', 'descricao', 'valor', 'responsavel', 'categoria', 'projeto_fatura', 'data', 'cartao', 'parcela_atual', 'total_parcelas', 'status', 'created_at']
const OPCIONAIS_COMPRA = ['descricao_personalizada']
const COLUNAS_PLANEJAMENTO = ['id', 'item', 'responsavel', 'valor_previsto', 'categoria', 'mes_referencia', 'parcela_atual', 'total_parcelas', 'data_vencimento', 'data_pagamento', 'valor_real', 'pago', 'created_at']

/** Recorte de compras + planejamento (+ estornos, que moram na mesma tabela das compras). */
export interface Historico {
  transacoes: Transacao[]
  planejamento: Planejamento[]
  estornos: Estorno[]
}

/**
 * Compras e planejamento com `desde <= mês < ate` (datas 'YYYY-MM-01').
 * Sem `ate`, até o fim. Ordem: mais recente primeiro — acrescentar um trecho
 * mais antigo no fim mantém a ordem da lista inteira.
 */
export async function carregarHistorico(
  supabase: SupabaseClient,
  intervalo: { desde?: string; ate?: string }
): Promise<Historico> {
  const recorte = (coluna: string): FiltroBanco[] => [
    ...(intervalo.desde ? [{ op: 'gte' as const, coluna, valor: intervalo.desde }] : []),
    ...(intervalo.ate ? [{ op: 'lt' as const, coluna, valor: intervalo.ate }] : []),
  ]

  const [compras, planejamento] = await Promise.all([
    obrigatoria('as compras de cartão', () => lerTabela<Transacao & { status?: string | null }>(supabase, {
      tabela: 'transacoes_nubank',
      colunas: COLUNAS_COMPRA,
      opcionais: OPCIONAIS_COMPRA,
      filtros: recorte('projeto_fatura'),
      ordem: [{ coluna: 'projeto_fatura', asc: false }, { coluna: 'id', asc: true }],
      maxPaginas: 60,
    })),
    obrigatoria('o planejamento', () => lerTabela<Planejamento>(supabase, {
      tabela: 'planejamento',
      colunas: COLUNAS_PLANEJAMENTO,
      filtros: recorte('mes_referencia'),
      ordem: [{ coluna: 'mes_referencia', asc: false }, { coluna: 'id', asc: true }],
      maxPaginas: 60,
    })),
  ])

  // Uma leitura só para compras e estornos. O filtro `neq('status', …)` que
  // havia antes também descartava compras com status nulo.
  const transacoes: Transacao[] = []
  const estornos: Estorno[] = []
  for (const t of compras.linhas) {
    if (t.status && STATUS_ESTORNO.has(t.status)) {
      estornos.push({
        descricao: t.descricao,
        valor: t.valor,
        data: t.data,
        cartao: t.cartao,
        projeto_fatura: t.projeto_fatura,
        status: t.status,
      })
    } else {
      transacoes.push(t)
    }
  }
  estornos.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''))

  return { transacoes, planejamento: planejamento.linhas, estornos }
}

/** Mês mais antigo com registro (compras e planejamento) — diz se há histórico além da janela. */
export async function primeiroMesComDados(supabase: SupabaseClient): Promise<string | null> {
  const [tx, pl] = await Promise.all([
    supabase.from('transacoes_nubank').select('projeto_fatura').order('projeto_fatura', { ascending: true }).limit(1),
    supabase.from('planejamento').select('mes_referencia').order('mes_referencia', { ascending: true }).limit(1),
  ])
  const datas = [
    (tx.data?.[0] as { projeto_fatura?: string } | undefined)?.projeto_fatura,
    (pl.data?.[0] as { mes_referencia?: string } | undefined)?.mes_referencia,
  ].filter((d): d is string => Boolean(d)).map(d => d.substring(0, 7) + '-01').sort()
  return datas[0] ?? null
}

async function obrigatoria<T>(fonte: string, busca: () => Promise<T>): Promise<T> {
  try { return await busca() }
  catch (err) { throw new DadosIndisponiveisError(fonte, err instanceof Error ? err.message : String(err)) }
}

/**
 * Carrega o núcleo completo com a janela quente começando em `desde`.
 * Fontes obrigatórias (compras, planejamento) derrubam o turno se falharem;
 * as demais viram um aviso, repassado ao modelo, em vez de um "zero" mudo.
 */
export async function carregarNucleo(supabase: SupabaseClient, desde: string): Promise<EnrichedData> {
  const avisos: string[] = []

  const opcional = async <T>(fonte: string, busca: () => Promise<T[]>): Promise<T[]> => {
    try { return await busca() }
    catch (err) {
      console.error(`[dados] ${fonte}:`, err instanceof Error ? err.message : err)
      avisos.push(`Não foi possível carregar ${fonte} agora — não afirme nada sobre isso como se fosse zero.`)
      return []
    }
  }
  const tabela = <T>(fonte: string, c: Parameters<typeof lerTabela>[1]) =>
    opcional(fonte, async () => (await lerTabela<T>(supabase, c)).linhas)

  const [
    historico,
    configuracoes,
    assinaturas,
    investimentos,
    aportes,
    limites,
    recebimentos,
    faturas,
    desejos,
    mercado,
    listasCompras,
  ] = await Promise.all([
    carregarHistorico(supabase, { desde }),

    tabela<EnrichedData['configuracoes'][number]>('as configurações', {
      tabela: 'configuracoes',
      colunas: ['chave', 'valor'],
      ordem: [{ coluna: 'chave', asc: true }],
    }),

    tabela<EnrichedData['assinaturas'][number]>('as assinaturas', {
      tabela: 'assinaturas',
      colunas: ['id', 'nome', 'valor', 'cartao', 'responsavel', 'categoria', 'ativa', 'dia_cobranca', 'observacao', 'created_at'],
      opcionais: ['pausada_ate', 'moeda', 'valor_origem'],
      ordem: [{ coluna: 'valor', asc: false }, { coluna: 'id', asc: true }],
    }),

    tabela<EnrichedData['investimentos'][number]>('os investimentos', {
      tabela: 'investimentos',
      colunas: ['id', 'descricao', 'percentual', 'mes_referencia'],
      opcionais: ['saldo_atual'],
      ordem: [{ coluna: 'mes_referencia', asc: false }, { coluna: 'id', asc: true }],
    }),

    // saldo_atual é o saldo que o usuário informa ao registrar o aporte — a
    // única fonte de "quanto tenho investido" que o app tem.
    tabela<EnrichedData['aportes'][number]>('os aportes de investimento', {
      tabela: 'investimentos_aportes',
      colunas: ['investimento_id', 'valor', 'data_aporte', 'observacao'],
      opcionais: ['saldo_atual'],
      ordem: [{ coluna: 'data_aporte', asc: false }, { coluna: 'id', asc: true }],
    }),

    opcional('os limites de parcelamento', async () => {
      const { linhas } = await lerTabela<{ mes_referencia: string; responsavel: string; valor: number | string | null }>(supabase, {
        tabela: 'limites_parcelamentos',
        colunas: ['mes_referencia', 'responsavel', 'valor'],
        ordem: [{ coluna: 'mes_referencia', asc: false }, { coluna: 'responsavel', asc: true }],
      })
      return linhas.map(l => ({ ...l, valor: Number(l.valor ?? 0) }))
    }),

    tabela<NonNullable<EnrichedData['recebimentos']>[number]>('os recebimentos de receitas', {
      tabela: 'receitas_recebimentos',
      colunas: ['planejamento_id', 'valor', 'data_recebimento', 'observacao'],
      ordem: [{ coluna: 'planejamento_id', asc: true }, { coluna: 'id', asc: true }],
    }),

    tabela<NonNullable<EnrichedData['faturas']>[number]>('as datas de fechamento das faturas', {
      tabela: 'faturas',
      colunas: ['cartao', 'mes_referencia', 'data_fechamento'],
      ordem: [{ coluna: 'mes_referencia', asc: false }, { coluna: 'id', asc: true }],
    }),

    tabela<NonNullable<EnrichedData['desejos']>[number]>('a lista de desejos', {
      tabela: 'wishlist_items',
      colunas: ['nome', 'valor_estimado', 'prioridade', 'realizado', 'categoria', 'criado_por', 'created_at'],
      opcionais: ['nota', 'link_ref', 'realizado_em'],
      ordem: [{ coluna: 'created_at', asc: false }, { coluna: 'id', asc: true }],
    }),

    tabela<NonNullable<EnrichedData['mercado']>[number]>('a lista de mercado', {
      tabela: 'lista_mercado_itens',
      colunas: ['nome', 'quantidade', 'preco_unit', 'comprado', 'created_at'],
      opcionais: ['category', 'unit', 'estimated_price', 'criado_por'],
      ordem: [{ coluna: 'created_at', asc: true }, { coluna: 'id', asc: true }],
    }),

    opcional('as listas de compras', async () => {
      // Todas as listas (não só as ativas): "quanto gastamos na lista da
      // mudança?" é sobre uma lista já concluída.
      const { linhas: listas } = await lerTabela<{ id: string; nome: string; status: string | null }>(supabase, {
        tabela: 'listas_compras',
        colunas: ['id', 'nome', 'status'],
        ordem: [{ coluna: 'created_at', asc: false }, { coluna: 'id', asc: true }],
      })
      if (listas.length === 0) return [] as ItemListaCompras[]
      const porId = new Map(listas.map(l => [l.id, l]))
      const { linhas: itens } = await lerTabela<Record<string, unknown>>(supabase, {
        tabela: 'listas_compras_itens',
        colunas: ['lista_id', 'nome', 'quantidade', 'pessoa', 'preco_previsto', 'preco_pago', 'status'],
        opcionais: ['data_compra'],
        filtros: [{ op: 'in', coluna: 'lista_id', valor: [...porId.keys()] }],
        ordem: [{ coluna: 'lista_id', asc: true }, { coluna: 'id', asc: true }],
      })
      return itens.map(i => {
        const lista = porId.get(i.lista_id as string)
        return {
          lista: lista?.nome ?? 'Lista',
          status_lista: lista?.status ?? null,
          nome: i.nome,
          quantidade: i.quantidade,
          pessoa: i.pessoa,
          preco_previsto: i.preco_previsto,
          preco_pago: i.preco_pago,
          status: i.status,
          data_compra: i.data_compra ?? null,
        } as ItemListaCompras
      })
    }),
  ])

  return {
    transacoes: historico.transacoes,
    planejamento: historico.planejamento,
    estornos: historico.estornos,
    configuracoes,
    assinaturas,
    investimentos,
    aportes,
    limites,
    recebimentos,
    faturas,
    desejos,
    mercado,
    listasCompras,
    avisos,
    ts: Date.now(),
  }
}
