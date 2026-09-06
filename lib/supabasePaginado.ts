/**
 * Leitura paginada do Supabase.
 *
 * O PostgREST devolve no máximo 1000 linhas por requisição e não avisa que
 * cortou — a consulta "sucede" com os dados pela metade. Em um mês isso nunca
 * aparece; em uma janela de 12 meses de compras, o total do relatório fica
 * silenciosamente errado. Este helper vai buscando faixas até a página vir
 * incompleta.
 */

const TAMANHO_PAGINA = 1000

/** Teto de segurança: 20 páginas = 20 mil linhas. Acima disso algo está errado. */
const MAX_PAGINAS = 20

interface RespostaPagina<T> {
  data: T[] | null
  error: unknown
}

export async function buscarPaginado<T>(
  consultar: (inicio: number, fim: number) => PromiseLike<RespostaPagina<T>>,
): Promise<{ data: T[]; error: unknown; truncado: boolean }> {
  const linhas: T[] = []

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const inicio = pagina * TAMANHO_PAGINA
    const { data, error } = await consultar(inicio, inicio + TAMANHO_PAGINA - 1)

    if (error) return { data: linhas, error, truncado: false }

    const recebidas = data ?? []
    linhas.push(...recebidas)

    if (recebidas.length < TAMANHO_PAGINA) return { data: linhas, error: null, truncado: false }
  }

  return { data: linhas, error: null, truncado: true }
}
