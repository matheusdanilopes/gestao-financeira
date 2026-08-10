export interface HistoricoStatusEntry {
  assinatura_id: string
  ativa: boolean
  vigente_desde: string // 'YYYY-MM-DD'
  criado_em: string
}

/** Resolve se uma assinatura estava ativa no mês informado, usando a última
 * entrada de assinaturas_status_historico com vigente_desde <= fim do mês,
 * com fallback para o estado atual da assinatura. Mesmo padrão de
 * valorEfetivoNoMes (lib/assinaturaValor.ts), evitando que uma reativação
 * feita hoje "vaze" para meses passados em que a assinatura estava inativa. */
export function ativaEfetivaNoMes(
  assinaturaId: string,
  ativaAtual: boolean,
  cutoffISO: string,
  historico: HistoricoStatusEntry[]
): boolean {
  const entry = historico
    .filter(h => h.assinatura_id === assinaturaId && h.vigente_desde <= cutoffISO)
    .sort((a, b) => {
      const d = b.vigente_desde.localeCompare(a.vigente_desde)
      return d !== 0 ? d : b.criado_em.localeCompare(a.criado_em)
    })[0]
  return entry?.ativa ?? ativaAtual
}
