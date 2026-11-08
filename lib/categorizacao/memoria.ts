/**
 * Memória de categorias do casal: o que ELES escolheram para cada
 * estabelecimento, vindo de duas fontes — a tabela classificacoes_aprendidas
 * e as compras que categorizaram à mão.
 *
 * O que mudou em relação à versão anterior, e por quê (dados de 08/11/2026):
 *  - 123 compras estavam em "Outros" por HISTORICO: a memória propagava
 *    "Outros", que entrou nela sem ninguém escolher (editar o valor de uma
 *    compra gravava a categoria atual como "aprendida"). "Outros" nunca é
 *    aplicado automaticamente a partir da memória.
 *  - "Mercadolivre*Mercadol" foi rotulado como Mercado, Festa, Cosméticos,
 *    Presente e Viagem: marketplace genérico não diz o que foi comprado, então
 *    a memória não decide por ele.
 *  - Lugar com rótulos divergentes só é aplicado quando uma categoria domina
 *    (≥ 75%); senão a IA decide, vendo esses rótulos como exemplo.
 */
import {
  normalizarEstabelecimento,
  chaveDeMemoriaAntiga,
  similaridade,
  tokensInformativos,
} from './normalizacao'

export interface EntradaMemoria {
  /** Descrição (da fatura) ou chave já limpa (formato antigo da tabela). */
  descricao: string
  categoria: string
  peso: number
  /** true para descricao_limpa da tabela antiga (sem asterisco). */
  formatoAntigo?: boolean
}

export interface DecisaoMemoria {
  categoria: string
  confianca: number
  motivo: string
}

const DOMINANCIA_MINIMA = 0.75
const SIMILARIDADE_MINIMA = 0.75

export class MemoriaCategorias {
  /** chave → categoria → peso */
  private readonly mapa = new Map<string, Map<string, number>>()

  constructor(entradas: EntradaMemoria[], private readonly permitidas: string[]) {
    for (const e of entradas) {
      if (!e.categoria || e.categoria === 'Outros' || !permitidas.includes(e.categoria)) continue
      const est = normalizarEstabelecimento(e.descricao)
      if (est.generico) continue
      const chave = e.formatoAntigo ? chaveDeMemoriaAntiga(e.descricao) : est.chave
      if (!chave) continue
      const dist = this.mapa.get(chave) ?? new Map<string, number>()
      dist.set(e.categoria, (dist.get(e.categoria) ?? 0) + Math.max(1, e.peso))
      this.mapa.set(chave, dist)
    }
  }

  get tamanho(): number {
    return this.mapa.size
  }

  private dominante(dist: Map<string, number>): { categoria: string; share: number; total: number } | null {
    let total = 0
    let melhor: [string, number] | null = null
    for (const [c, p] of dist) {
      total += p
      if (!melhor || p > melhor[1]) melhor = [c, p]
    }
    return melhor ? { categoria: melhor[0], share: melhor[1] / total, total } : null
  }

  /** Categoria que o casal costuma dar a este estabelecimento, se for clara. */
  consultar(descricao: string): DecisaoMemoria | null {
    const est = normalizarEstabelecimento(descricao)
    if (est.generico) return null

    const exata = this.mapa.get(est.chave)
    if (exata) {
      const d = this.dominante(exata)
      if (d && d.share >= DOMINANCIA_MINIMA) {
        return { categoria: d.categoria, confianca: Math.min(0.99, 0.75 + 0.24 * d.share), motivo: `memória: "${est.chave}" (${d.total}x)` }
      }
      return null // rótulos divergentes: deixa a IA decidir
    }

    // Parecido o bastante (mesma loja escrita de outro jeito: "lojas renner fl" × "lojas renner fl 476 sh").
    const agregada = new Map<string, number>()
    for (const [chave, dist] of this.mapa) {
      if (similaridade(est.chave, chave) < SIMILARIDADE_MINIMA) continue
      for (const [c, p] of dist) agregada.set(c, (agregada.get(c) ?? 0) + p)
    }
    const d = this.dominante(agregada)
    if (d && d.share >= DOMINANCIA_MINIMA) {
      return { categoria: d.categoria, confianca: Math.min(0.9, 0.7 + 0.2 * d.share), motivo: `memória: parecido com "${est.chave}"` }
    }
    return null
  }

  /** Exemplos de rótulos do casal parecidos com esta descrição (para a IA). */
  exemplosParecidos(descricao: string, limite = 3): Array<{ chave: string; categoria: string }> {
    const est = normalizarEstabelecimento(descricao)
    if (tokensInformativos(est.chave).length === 0) return []
    return [...this.mapa.entries()]
      .map(([chave, dist]) => ({ chave, dist, s: similaridade(est.chave, chave) }))
      .filter(x => x.s > 0 && x.chave !== est.chave)
      .sort((a, b) => b.s - a.s)
      .slice(0, limite)
      .map(x => ({ chave: x.chave, categoria: this.dominante(x.dist)!.categoria }))
  }

  /** Os rótulos mais usados — o "jeito do casal" de categorizar, para a IA. */
  exemplosGerais(limite = 40, porCategoria = 3): Array<{ chave: string; categoria: string }> {
    const ordenados = [...this.mapa.entries()]
      .map(([chave, dist]) => ({ chave, d: this.dominante(dist)! }))
      .filter(x => x.d.share >= DOMINANCIA_MINIMA)
      .sort((a, b) => b.d.total - a.d.total)
    // Primeiro alguns de cada categoria (variedade), depois os mais frequentes.
    const escolhidos: typeof ordenados = []
    const contagem = new Map<string, number>()
    for (const x of ordenados) {
      if ((contagem.get(x.d.categoria) ?? 0) >= porCategoria) continue
      contagem.set(x.d.categoria, (contagem.get(x.d.categoria) ?? 0) + 1)
      escolhidos.push(x)
    }
    for (const x of ordenados) {
      if (escolhidos.length >= limite) break
      if (!escolhidos.includes(x)) escolhidos.push(x)
    }
    return escolhidos.slice(0, limite).map(x => ({ chave: x.chave, categoria: x.d.categoria }))
  }
}
