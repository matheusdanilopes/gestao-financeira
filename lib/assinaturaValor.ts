export interface HistoricoValorEntry {
  assinatura_id: string
  valor: number
  vigente_desde: string // 'YYYY-MM-DD'
  criado_em: string
}

/** Resolve o valor efetivo (BRL) de uma assinatura para o mês informado, usando a
 * última entrada de assinaturas_historico com vigente_desde <= fim do mês, com
 * fallback para o valor atual da assinatura. */
export function valorEfetivoNoMes(
  assinaturaId: string,
  valorAtual: number,
  cutoffISO: string,
  historico: HistoricoValorEntry[]
): number {
  const entry = historico
    .filter(h => h.assinatura_id === assinaturaId && h.vigente_desde <= cutoffISO)
    .sort((a, b) => {
      const d = b.vigente_desde.localeCompare(a.vigente_desde)
      return d !== 0 ? d : b.criado_em.localeCompare(a.criado_em)
    })[0]
  return entry?.valor ?? valorAtual
}
