// Busca, filtro e ordenação da seção "Comprados" da Lista de Mercado —
// facilita achar um item para corrigir ou conferir com a nota fiscal.

import { normalizarNomeItem } from './listaMercadoDuplicados'

export type OrdemComprados = 'recentes' | 'az' | 'valor'

export const ORDENS_COMPRADOS: { valor: OrdemComprados; rotulo: string }[] = [
  { valor: 'recentes', rotulo: 'Recentes' },
  { valor: 'az', rotulo: 'A–Z' },
  { valor: 'valor', rotulo: 'Valor' },
]

export function ehOrdemComprados(v: unknown): v is OrdemComprados {
  return v === 'recentes' || v === 'az' || v === 'valor'
}

type ItemComprado = {
  id: string
  nome: string
  quantidade: number
  preco_unit: number | null
  updated_at: string
}

/**
 * Filtra e ordena os comprados.
 * - `busca`: por nome, ignorando acentos, maiúsculas e espaços extras;
 *   todas as palavras digitadas precisam aparecer ("arroz 5" acha "Arroz tipo 1 5kg").
 * - `soSemPreco`: só itens sem preço unitário.
 * - `marcadoEm`: momento em que o item foi marcado nesta sessão (para "Recentes");
 *   sem registro, usa `updated_at`.
 */
export function filtrarComprados<T extends ItemComprado>(
  itens: readonly T[],
  opcoes: {
    busca: string
    soSemPreco: boolean
    ordem: OrdemComprados
    marcadoEm?: Readonly<Record<string, number>>
  },
): T[] {
  const termos = normalizarNomeItem(opcoes.busca).split(' ').filter(Boolean)
  const filtrados = itens.filter(item => {
    if (opcoes.soSemPreco && item.preco_unit != null) return false
    if (!termos.length) return true
    const nome = normalizarNomeItem(item.nome)
    return termos.every(t => nome.includes(t))
  })

  const marcadoEm = opcoes.marcadoEm ?? {}
  const momento = (i: T) => marcadoEm[i.id] ?? (Date.parse(i.updated_at) || 0)
  const nomeOrd = (a: T, b: T) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })

  return [...filtrados].sort((a, b) => {
    if (opcoes.ordem === 'az') return nomeOrd(a, b)
    if (opcoes.ordem === 'valor') {
      // Sem preço vai para o fim
      const va = a.preco_unit == null ? -1 : a.quantidade * a.preco_unit
      const vb = b.preco_unit == null ? -1 : b.quantidade * b.preco_unit
      return vb - va || nomeOrd(a, b)
    }
    return momento(b) - momento(a) || nomeOrd(a, b)
  })
}
