// Classificação do que compõe o valor gasto de uma fatura NuBank: parcelas de
// compras de meses anteriores (2/X em diante), novas parcelas/compras à vista
// (1/X) e assinaturas. Compartilhado entre o Dashboard (cálculo das barras) e
// a tela de Compras (filtro "Tipo de gasto"), para que o clique numa barra
// leve a exatamente os mesmos lançamentos que a compuseram.

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
  if (parcelaAtual && totalParcelas) return { atual: Number(parcelaAtual), total: Number(totalParcelas) }
  const desc = String(descricao || '')
  const matchParcela = desc.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (matchParcela) return { atual: Number(matchParcela[1]), total: Number(matchParcela[2]) }
  const matchSlash = desc.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (matchSlash) {
    const atual = Number(matchSlash[1])
    const total = Number(matchSlash[2])
    if (total >= 2) return { atual, total }
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
