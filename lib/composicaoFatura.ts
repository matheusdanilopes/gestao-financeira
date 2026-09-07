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
