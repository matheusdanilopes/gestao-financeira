import { addMonths, format, parseISO, startOfMonth } from 'date-fns'
import { supabase } from './supabaseClient'

// Linhas de `planejamento`/`investimentos` são um snapshot por mês, sem qualquer
// vínculo (id de série/recorrência) entre a ocorrência de um mês e a do mês seguinte.
// Por isso "aplicar aos meses futuros" precisa casar registros por um critério de
// identidade textual (descrição + responsável, quando existir) em vez de uma FK.

export const MESES_FUTUROS_PADRAO = 12
export const MESES_FUTUROS_MAXIMO = 36

type Filtros = Record<string, string>

/** Primeiro dia de cada um dos próximos `quantidade` meses após `mesAtual`. */
export function gerarMesesFuturos(mesAtual: Date, quantidade: number): Date[] {
  const inicio = startOfMonth(mesAtual)
  return Array.from({ length: quantidade }, (_, i) => addMonths(inicio, i + 1))
}

/**
 * Campos de `novos` cujo valor difere de `original`. "Aplicar aos meses futuros"
 * propaga só o que o usuário realmente mexeu no formulário: enviar o objeto
 * inteiro sobrescreveria, nas ocorrências futuras, valores que foram
 * personalizados mês a mês e que a edição atual nem tocou.
 */
export function camposAlterados<T extends Record<string, unknown>>(
  original: Partial<T>,
  novos: T
): Partial<T> {
  const alterados: Partial<T> = {}
  for (const chave of Object.keys(novos) as Array<keyof T>) {
    if (!Object.is(original[chave] ?? null, novos[chave] ?? null)) {
      alterados[chave] = novos[chave]
    }
  }
  return alterados
}

/**
 * Atualiza os registros de `tabela` com `mes_referencia` posterior ao mês atual
 * que casam com `filtros` (ex.: mesma descrição/responsável). Usado para propagar
 * uma edição para ocorrências futuras já existentes. Retorna quantos registros
 * foram alterados.
 *
 * `ajustarPorMes`, quando informado, recebe o `mes_referencia` de cada linha
 * futura e devolve campos específicos daquele mês (ex.: a data de vencimento
 * recalculada). Nesse caso as linhas são buscadas antes e agrupadas por
 * resultado, de modo que basta um update por valor distinto.
 */
export async function atualizarRegistrosFuturos(
  tabela: string,
  filtros: Filtros,
  mesAtual: Date,
  updates: Record<string, unknown>,
  ajustarPorMes?: (mes: Date) => Record<string, unknown>
): Promise<number> {
  const mesAtualStr = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

  if (!ajustarPorMes) {
    if (Object.keys(updates).length === 0) return 0
    let query = supabase.from(tabela).update(updates).gt('mes_referencia', mesAtualStr)
    for (const [coluna, valor] of Object.entries(filtros)) {
      query = query.eq(coluna, valor)
    }
    const { data, error } = await query.select('id')
    if (error) throw error
    return data?.length ?? 0
  }

  let busca = supabase.from(tabela).select('id, mes_referencia').gt('mes_referencia', mesAtualStr)
  for (const [coluna, valor] of Object.entries(filtros)) {
    busca = busca.eq(coluna, valor)
  }
  const { data: futuros, error: erroBusca } = await busca
  if (erroBusca) throw erroBusca
  if (!futuros || futuros.length === 0) return 0

  // Agrupa por conjunto de campos calculados: meses que chegam ao mesmo
  // resultado (ex.: o mesmo vencimento) viram um único update.
  const porAjuste = new Map<string, { campos: Record<string, unknown>; ids: string[] }>()
  for (const linha of futuros as Array<{ id: string; mes_referencia: string }>) {
    const campos = ajustarPorMes(parseISO(linha.mes_referencia))
    const chave = JSON.stringify(campos)
    const grupo = porAjuste.get(chave)
    if (grupo) grupo.ids.push(linha.id)
    else porAjuste.set(chave, { campos, ids: [linha.id] })
  }

  const resultados = await Promise.all(
    Array.from(porAjuste.values()).map(async ({ campos, ids }) => {
      const { data, error } = await supabase
        .from(tabela)
        .update({ ...updates, ...campos })
        .in('id', ids)
        .select('id')
      if (error) throw error
      return data?.length ?? 0
    })
  )
  return resultados.reduce((total, n) => total + n, 0)
}

/**
 * Exclui os registros de `tabela` com `mes_referencia` posterior ao mês atual
 * que casam com `filtros`. Retorna quantos registros foram removidos.
 */
export async function excluirRegistrosFuturos(
  tabela: string,
  filtros: Filtros,
  mesAtual: Date
): Promise<number> {
  const mesAtualStr = format(startOfMonth(mesAtual), 'yyyy-MM-dd')
  let query = supabase.from(tabela).delete().gt('mes_referencia', mesAtualStr)
  for (const [coluna, valor] of Object.entries(filtros)) {
    query = query.eq(coluna, valor)
  }
  const { data, error } = await query.select('id')
  if (error) throw error
  return data?.length ?? 0
}

/**
 * Insere uma cópia de `base` em cada um dos próximos `quantidade` meses após
 * `mesAtual` — usado ao incluir um item novo já marcado para repetir nos meses
 * futuros. `base` não deve conter `mes_referencia` (é preenchido por mês aqui).
 * Quando `ajustarPorMes` é informado, ele recebe o mês de cada nova linha e pode
 * devolver campos adicionais/sobrescritos específicos daquele mês (ex.: mover a
 * data de vencimento preservando o dia, ou avançar o número da parcela).
 */
export async function criarRegistrosFuturos(
  tabela: string,
  base: Record<string, unknown>,
  mesAtual: Date,
  quantidade: number,
  ajustarPorMes?: (mes: Date) => Record<string, unknown>
): Promise<number> {
  const linhas = gerarMesesFuturos(mesAtual, quantidade).map((mes) => ({
    ...base,
    mes_referencia: format(mes, 'yyyy-MM-dd'),
    ...(ajustarPorMes ? ajustarPorMes(mes) : {}),
  }))
  if (linhas.length === 0) return 0
  const { error } = await supabase.from(tabela).insert(linhas)
  if (error) throw error
  return linhas.length
}
