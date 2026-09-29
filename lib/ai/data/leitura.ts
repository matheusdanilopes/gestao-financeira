/**
 * Leitura crua do Supabase para a camada de dados da IA.
 *
 * Duas coisas que toda fonte precisa e que antes eram repetidas (ou
 * esquecidas) em cada consulta:
 *  - paginação: o PostgREST devolve no máximo 1000 linhas por select e não
 *    avisa que cortou — sem paginar, o histórico mais antigo sumia calado;
 *  - colunas opcionais: instâncias sem uma migração (ex.: `pausada_ate`,
 *    `descricao_personalizada`) não podem perder a fonte inteira por causa de
 *    uma coluna nova. Se o erro citar uma coluna opcional, repete sem ela.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const TAMANHO_PAGINA = 1000

type Pagina = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>

export interface ResultadoLeitura<T> {
  linhas: T[]
  /** true quando o teto de páginas foi atingido e ainda havia mais linhas. */
  truncado: boolean
}

/** Busca todas as páginas de uma consulta. `montar` precisa ter ordenação estável. */
export async function buscarTudo<T>(
  montar: (de: number, ate: number) => Pagina,
  maxPaginas = 30
): Promise<ResultadoLeitura<T>> {
  const linhas: T[] = []
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const de = pagina * TAMANHO_PAGINA
    const { data, error } = await montar(de, de + TAMANHO_PAGINA - 1)
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as T[]
    linhas.push(...lote)
    if (lote.length < TAMANHO_PAGINA) return { linhas, truncado: false }
  }
  return { linhas, truncado: true }
}

/** Um filtro simples aplicado no banco (o resto é filtrado em memória). */
export type FiltroBanco =
  | { op: 'gte' | 'lte' | 'lt' | 'eq' | 'neq'; coluna: string; valor: string | number | boolean }
  | { op: 'in'; coluna: string; valor: Array<string | number> }

export interface ConsultaTabela {
  tabela: string
  colunas: string[]
  /** Colunas que podem não existir em instâncias antigas. */
  opcionais?: string[]
  filtros?: FiltroBanco[]
  /** Ordenação estável — a última coluna deve ser única (normalmente `id`). */
  ordem: Array<{ coluna: string; asc: boolean }>
  maxPaginas?: number
}

/**
 * Lê uma tabela inteira (dentro dos filtros), paginando e tolerando colunas
 * opcionais ausentes. Erros de verdade são lançados para quem chamou decidir
 * se a fonte é obrigatória ou não.
 */
export async function lerTabela<T>(supabase: SupabaseClient, c: ConsultaTabela): Promise<ResultadoLeitura<T>> {
  let colunas = [...c.colunas, ...(c.opcionais ?? [])]
  const ordem = c.ordem

  for (let tentativa = 0; tentativa <= (c.opcionais?.length ?? 0); tentativa++) {
    try {
      return await buscarTudo<T>((de, ate) => {
        let q = supabase.from(c.tabela).select(colunas.join(','))
        for (const f of c.filtros ?? []) {
          switch (f.op) {
            case 'in': q = q.in(f.coluna, f.valor); break
            case 'gte': q = q.gte(f.coluna, f.valor); break
            case 'lte': q = q.lte(f.coluna, f.valor); break
            case 'lt': q = q.lt(f.coluna, f.valor); break
            case 'eq': q = q.eq(f.coluna, f.valor); break
            case 'neq': q = q.neq(f.coluna, f.valor); break
          }
        }
        for (const o of ordem) q = q.order(o.coluna, { ascending: o.asc })
        return q.range(de, ate) as unknown as Pagina
      }, c.maxPaginas)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const ausente = (c.opcionais ?? []).find(col => colunas.includes(col) && msg.includes(col))
      if (!ausente) throw err
      colunas = colunas.filter(col => col !== ausente)
    }
  }
  throw new Error(`Falha ao ler ${c.tabela}`)
}
