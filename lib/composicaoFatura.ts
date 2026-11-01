import { extrairParcela } from './parcelaDescricao'
import { transacaoEhCobrancaDeAssinatura } from './assinaturaMatch'

// Classificação do que compõe o valor gasto de uma fatura NuBank: parcelas de
// compras de meses anteriores (2/X em diante), novas parcelas/compras à vista
// (1/X) e assinaturas. Compartilhado entre o Dashboard (cálculo das barras) e
// a tela de Compras (filtro "Tipo de gasto"), para que o clique numa barra
// leve a exatamente os mesmos lançamentos que a compuseram.

export interface TransacaoParaTotal {
  valor: number
  status?: string | null
  conciliacao_ref?: string | null
}

/**
 * Soma os valores de um conjunto de transações tratando estornos corretamente:
 * - Uma compra marcada ESTORNADO (par de estorno encontrado) é descartada, e o
 *   estorno correspondente (status ESTORNO com conciliacao_ref preenchido)
 *   também é descartado — as duas se cancelam, impacto zero.
 * - Um estorno SEM par (conciliacao_ref nulo — o casamento por nome+data+valor
 *   não achou a compra original, comum em estorno parcial ou descrição
 *   divergente do extrato) precisa ser SUBTRAÍDO: a compra original continua
 *   contando o valor cheio, então o crédito recebido precisa abater esse
 *   valor — do contrário o total fica maior que a fatura real do NuBank.
 */
export function somarValorFatura<T extends TransacaoParaTotal>(transacoes: T[]): number {
  return transacoes.reduce((acc, t) => {
    if (t.status === 'ESTORNADO') return acc
    if (t.status === 'ESTORNO') return t.conciliacao_ref ? acc : acc - t.valor
    return acc + t.valor
  }, 0)
}

export { extrairParcela }
export type { ParcelaInfo } from './parcelaDescricao'

export type TipoGasto = 'existente' | 'novo' | 'assinatura'

export interface AssinaturaAtiva {
  nome: string
  responsavel: string
  /** Valor vigente da assinatura. Quando informado, uma compra no mesmo
   *  estabelecimento com valor fora da faixa plausível deixa de ser contada
   *  como assinatura (ex.: cupons avulsos do iFood x iFood Club). */
  valor?: number | null
  moeda?: string | null
}

export function classificarTipoGasto(
  descricao: string | null | undefined,
  parcelaAtual: number | null | undefined,
  totalParcelas: number | null | undefined,
  responsavel: string | null | undefined,
  assinaturasAtivas: AssinaturaAtiva[],
  valor?: number | null
): TipoGasto {
  // Mesmas regras da identificação na tela de Assinaturas (lib/assinaturaMatch.ts):
  // nome por tokens sobre texto normalizado, compra não parcelada e valor dentro
  // da faixa plausível — evita que uma compra avulsa entre como assinatura.
  const ehAssinatura = transacaoEhCobrancaDeAssinatura(
    { descricao, valor, parcelaAtual, totalParcelas },
    assinaturasAtivas.filter(a => a.responsavel === responsavel)
  )
  if (ehAssinatura) return 'assinatura'
  const parcela = extrairParcela(descricao, parcelaAtual, totalParcelas)
  if (parcela && parcela.atual >= 2) return 'existente'
  return 'novo'
}

export type ComposicaoPorTipo = Record<TipoGasto, number>

/**
 * Decompõe o valor gasto de um conjunto de transações em parcelas antigas,
 * compras novas e assinaturas, com o mesmo tratamento de estornos de
 * somarValorFatura — a soma das partes bate com o total exibido:
 * - compra ESTORNADO e estorno com par (conciliacao_ref) se cancelam → ignorados;
 * - estorno SEM par é abatido do tipo em que ele próprio se classifica (ex.: um
 *   estorno "2/5" abate parcelas antigas). Se esse tipo não comportar o crédito
 *   inteiro, o excedente é abatido dos demais, para nenhuma parte ficar negativa.
 */
export function comporValorFatura<T extends TransacaoParaTotal>(
  transacoes: T[],
  classificar: (t: T) => TipoGasto
): ComposicaoPorTipo {
  const comp: ComposicaoPorTipo = { existente: 0, novo: 0, assinatura: 0 }
  const creditos: { tipo: TipoGasto; valor: number }[] = []
  for (const t of transacoes) {
    if (t.status === 'ESTORNADO') continue
    if (t.status === 'ESTORNO') {
      if (!t.conciliacao_ref) creditos.push({ tipo: classificar(t), valor: t.valor })
      continue
    }
    comp[classificar(t)] += t.valor
  }
  const ordem: TipoGasto[] = ['novo', 'existente', 'assinatura']
  for (const c of creditos) {
    let restante = c.valor
    for (const tipo of [c.tipo, ...ordem.filter(o => o !== c.tipo)]) {
      if (restante <= 0) break
      const abate = Math.min(Math.max(comp[tipo], 0), restante)
      comp[tipo] -= abate
      restante -= abate
    }
    // Crédito maior que tudo: mantém a soma igual ao total (que fica negativo).
    if (restante > 0) comp[c.tipo] -= restante
  }
  return comp
}
