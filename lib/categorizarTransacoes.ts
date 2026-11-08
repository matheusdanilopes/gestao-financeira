/**
 * Categorização das compras: lê do banco, decide (lib/categorizacao/pipeline)
 * e grava. Único caminho usado pela importação, pelo botão "Categorizar com
 * IA" (/api/categorizar) e por /api/classificar — antes eram três cópias, uma
 * delas ainda no Gemini 1.5.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'
import { MemoriaCategorias, type EntradaMemoria } from '@/lib/categorizacao/memoria'
import {
  decidirCategorias,
  type TransacaoParaCategorizar,
  type CompraCategorizada,
  type Decisao,
} from '@/lib/categorizacao/pipeline'

/**
 * - novas:     só o que está sem categoria (importação).
 * - pendentes: sem categoria + "Outros" que não foi escolhido à mão (padrão do botão).
 * - tudo:      também refaz o que foi decidido automaticamente (IA, memória, regra, parcela).
 */
export type ModoCategorizacao = 'novas' | 'pendentes' | 'tudo'

export interface OpcoesCategorizar {
  hashLinhas?: string[]
  modo?: ModoCategorizacao
  /** Prazo para parar com elegância (o resto fica para a próxima rodada). */
  deadlineMs?: number
  aoProgresso?: (feitas: number, total: number) => void
}

export interface ResultadoCategorizar {
  categorized: number
  total: number
  cotaDiariaEsgotada: boolean
  /** Quantas ficaram marcadas para o casal conferir (palpite fraco ou "Outros"). */
  revisaoPendente?: number
  /** Quantas foram decididas por cada fonte. */
  porOrigem?: Record<string, number>
  erros?: string[]
}

const COLUNAS = 'hash_linha, descricao, descricao_personalizada, valor, parcela_atual, total_parcelas, responsavel, categoria, categoria_origem'
const ORIGENS_AUTOMATICAS = ['IA', 'HISTORICO', 'REGRA', 'PARCELA', 'RAG']
const PAGINA = 1000

type Linha = TransacaoParaCategorizar & { categoria: string | null; categoria_origem: string | null }

/** O PostgREST devolve no máximo 1000 linhas por consulta: lê página a página. */
async function lerTodas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    todas.push(...(data ?? []))
    if (!data || data.length < PAGINA) return todas
  }
}

export async function carregarMemoria(supabase: SupabaseClient, permitidas: string[]): Promise<MemoriaCategorias> {
  const [aprendidas, manuais] = await Promise.all([
    lerTodas<{ descricao_limpa: string; categoria_validada: string; frequencia: number }>((de, ate) =>
      supabase.from('classificacoes_aprendidas').select('descricao_limpa, categoria_validada, frequencia').range(de, ate)),
    lerTodas<{ descricao: string; categoria: string }>((de, ate) =>
      supabase.from('transacoes_nubank').select('descricao, categoria')
        .in('categoria_origem', ['MANUAL', 'USUARIO']).not('categoria', 'is', null).range(de, ate)),
  ])
  const entradas: EntradaMemoria[] = [
    ...aprendidas.map(a => ({ descricao: a.descricao_limpa, categoria: a.categoria_validada, peso: a.frequencia ?? 1, formatoAntigo: true })),
    ...manuais.map(m => ({ descricao: m.descricao, categoria: m.categoria, peso: 1 })),
  ]
  return new MemoriaCategorias(entradas, permitidas)
}

export async function categorizarTransacoes(
  supabase: SupabaseClient,
  apiKey: string | undefined,
  opcoes: OpcoesCategorizar = {}
): Promise<ResultadoCategorizar> {
  const modo = opcoes.modo ?? 'pendentes'
  const { data: config } = await supabase
    .from('configuracoes').select('valor').eq('chave', 'categorias_compras').maybeSingle()
  const permitidas = parseCategoriasConfig(config?.valor) || CATEGORIAS_PADRAO

  const linhas = await lerTodas<Linha>((de, ate) => {
    let q = supabase.from('transacoes_nubank').select(COLUNAS).or('is_estorno.is.null,is_estorno.eq.false')
    if (opcoes.hashLinhas?.length) q = q.in('hash_linha', opcoes.hashLinhas)
    return q.order('data', { ascending: false }).range(de, ate)
  })
  const alvo = linhas.filter(l => {
    if (!l.categoria) return true
    if (modo === 'novas') return false
    const automatica = ORIGENS_AUTOMATICAS.includes(l.categoria_origem ?? '')
    if (l.categoria === 'Outros' && (automatica || !l.categoria_origem)) return true
    return modo === 'tudo' && automatica
  })
  if (alvo.length === 0) return { categorized: 0, total: 0, cotaDiariaEsgotada: false }

  const memoria = await carregarMemoria(supabase, permitidas)
  // Parcelas já categorizadas (fora do alvo) servem de referência para as irmãs.
  const alvoHashes = new Set(alvo.map(a => a.hash_linha))
  const categorizadas: CompraCategorizada[] = (await lerTodas<Linha>((de, ate) =>
    supabase.from('transacoes_nubank').select(COLUNAS).gt('total_parcelas', 1).not('categoria', 'is', null).range(de, ate)))
    .filter(l => !alvoHashes.has(l.hash_linha))

  const resultado = await decidirCategorias(alvo, {
    permitidas,
    memoria,
    categorizadas,
    ia: apiKey ? { apiKey, deadlineMs: opcoes.deadlineMs ?? Date.now() + 240_000, pausaEntreLotesMs: 1_500 } : undefined,
    aoProgresso: opcoes.aoProgresso,
  })

  const erros = [...resultado.erros, ...(await gravarDecisoes(supabase, resultado.decisoes))]
  const porOrigem: Record<string, number> = {}
  for (const d of resultado.decisoes) porOrigem[d.origem] = (porOrigem[d.origem] ?? 0) + 1

  return {
    categorized: resultado.decisoes.length,
    total: alvo.length,
    cotaDiariaEsgotada: resultado.cotaDiariaEsgotada,
    revisaoPendente: resultado.decisoes.filter(d => d.status === 'revisao_pendente').length,
    porOrigem,
    erros: erros.length > 0 ? erros : undefined,
  }
}

/** Grava em blocos: uma atualização por combinação de categoria/origem/confiança/status. */
export async function gravarDecisoes(supabase: SupabaseClient, decisoes: Decisao[]): Promise<string[]> {
  const blocos = new Map<string, { campos: Record<string, unknown>; hashes: string[] }>()
  for (const d of decisoes) {
    const confianca = Math.round(d.confianca * 100) / 100
    const k = `${d.categoria}|${d.origem}|${confianca}|${d.status}`
    const b = blocos.get(k) ?? {
      campos: { categoria: d.categoria, categoria_origem: d.origem, categoria_confianca: confianca, classificacao_status: d.status },
      hashes: [],
    }
    b.hashes.push(d.hash_linha)
    blocos.set(k, b)
  }
  const erros: string[] = []
  for (const b of blocos.values()) {
    for (let i = 0; i < b.hashes.length; i += 200) {
      const { error } = await supabase.from('transacoes_nubank').update(b.campos).in('hash_linha', b.hashes.slice(i, i + 200))
      if (error) erros.push(`Falha ao gravar ${b.campos.categoria}: ${error.message}`)
    }
  }
  return erros
}
