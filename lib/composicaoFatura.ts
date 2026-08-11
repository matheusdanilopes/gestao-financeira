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

export type TipoGasto = 'existente' | 'novo' | 'assinatura'

export interface ParcelaInfo {
  atual: number
  total: number
}

export function extrairParcela(
  descricao?: string | null,
  parcelaAtual?: number | null,
  totalParcelas?: number | null
): ParcelaInfo | null {
  if (parcelaAtual && totalParcelas) {
    const atual = Number(parcelaAtual)
    const total = Number(totalParcelas)
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const desc = String(descricao || '')
  const matchParcela = desc.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (matchParcela) {
    const atual = Number(matchParcela[1])
    const total = Number(matchParcela[2])
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  // Sem limite de dígitos nem checagem de sanidade, esta regex casaria qualquer
  // "12/2024" (data) ou código embutido na descrição como se fosse parcela —
  // mesma classe de bug já corrigida em lib/csvparser.ts (extrairParcela).
  const matchSlash = desc.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (matchSlash) {
    const atual = Number(matchSlash[1])
    const total = Number(matchSlash[2])
    if (atual >= 1 && total >= atual && total >= 2) return { atual, total }
  }
  return null
}

export interface AssinaturaAtiva {
  nome: string
  responsavel: string
}

export function classificarTipoGasto(
  descricao: string | null | undefined,
  parcelaAtual: number | null | undefined,
  totalParcelas: number | null | undefined,
  responsavel: string | null | undefined,
  assinaturasAtivas: AssinaturaAtiva[]
): TipoGasto {
  const desc = (descricao || '').toLowerCase()
  const ehAssinatura = assinaturasAtivas.some(
    a => a.responsavel === responsavel && desc.includes(a.nome.toLowerCase())
  )
  if (ehAssinatura) return 'assinatura'
  const parcela = extrairParcela(descricao, parcelaAtual, totalParcelas)
  if (parcela && parcela.atual >= 2) return 'existente'
  return 'novo'
}
