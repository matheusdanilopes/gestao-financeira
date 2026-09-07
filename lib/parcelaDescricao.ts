// Extração do "N/M" de parcelamento a partir das colunas da transação ou, na
// falta delas, da própria descrição. Vive num módulo próprio porque é usada
// tanto pela classificação de gasto (lib/composicaoFatura.ts) quanto pela
// identificação de assinaturas (lib/assinaturaMatch.ts) — que não podem
// importar uma da outra sem criar ciclo.

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
