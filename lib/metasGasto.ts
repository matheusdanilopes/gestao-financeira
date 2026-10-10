/**
 * Metas de gasto mensal guardadas em `configuracoes` (chave → valor).
 *
 *  - meta_gasto_total        teto do casal: todos os cartões + contas fixas
 *  - meta_gasto_<Responsável> teto de compras no cartão de uma pessoa (ou do Conjunto)
 *  - limite_cat_<Categoria>   teto de compras no cartão de uma categoria
 *
 * A tela de Configurações grava; o painel de categorias e o assessor leem.
 */

export const CHAVE_META_TOTAL = 'meta_gasto_total'
export const PREFIXO_META_RESPONSAVEL = 'meta_gasto_'
export const PREFIXO_LIMITE_CATEGORIA = 'limite_cat_'

export const METAS_GASTO = [
  { chave: CHAVE_META_TOTAL, rotulo: 'Casal (total do mês)', ajuda: 'Todos os cartões + contas fixas' },
  { chave: `${PREFIXO_META_RESPONSAVEL}Matheus`, rotulo: 'Matheus', ajuda: 'Compras no cartão' },
  { chave: `${PREFIXO_META_RESPONSAVEL}Jeniffer`, rotulo: 'Jeniffer', ajuda: 'Compras no cartão' },
  { chave: `${PREFIXO_META_RESPONSAVEL}Conjunto`, rotulo: 'Conjunto', ajuda: 'Compras no cartão' },
] as const

export interface MetasGasto {
  total: number | null
  porResponsavel: Record<string, number>
  porCategoria: Record<string, number>
}

/** Valores ≤ 0 ou ilegíveis significam "sem meta". */
export function lerMetas(configs: Array<{ chave: string; valor: string | null }>): MetasGasto {
  const metas: MetasGasto = { total: null, porResponsavel: {}, porCategoria: {} }
  for (const { chave, valor } of configs) {
    const n = parseFloat(valor ?? '')
    if (!Number.isFinite(n) || n <= 0) continue
    if (chave === CHAVE_META_TOTAL) metas.total = n
    else if (chave.startsWith(PREFIXO_META_RESPONSAVEL)) metas.porResponsavel[chave.slice(PREFIXO_META_RESPONSAVEL.length)] = n
    else if (chave.startsWith(PREFIXO_LIMITE_CATEGORIA)) metas.porCategoria[chave.slice(PREFIXO_LIMITE_CATEGORIA.length)] = n
  }
  return metas
}

export const temMetas = (m: MetasGasto): boolean =>
  m.total !== null || Object.keys(m.porResponsavel).length > 0 || Object.keys(m.porCategoria).length > 0
