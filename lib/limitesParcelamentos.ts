// Resolução do limite mensal de parcelamentos "efetivo" para um mês/responsável,
// com herança do último mês configurado — mesma regra usada em
// components/ParcelamentosMensal.tsx, extraída para ser reaproveitada por
// qualquer tela que precise resolver o limite de um mês futuro (ex: o simulador).

export interface LimiteParcelamentoRow {
  mes_referencia: string
  responsavel: string
  valor: number
}

export interface LimiteEfetivo {
  valor: number
  mesOrigem: string
}

/**
 * Retorna o limite efetivo de `responsavel` em `mesAlvo` ('yyyy-MM-dd'): o valor
 * configurado para aquele mês, se existir, senão o do mês configurado mais
 * recente anterior a ele (herança futuro → passado). `null` se nenhum limite
 * foi configurado para esse responsável até `mesAlvo`.
 */
export function resolverLimiteEfetivo(
  limites: LimiteParcelamentoRow[],
  mesAlvo: string,
  responsavel: string,
): LimiteEfetivo | null {
  let melhor: LimiteParcelamentoRow | null = null
  for (const l of limites) {
    if (l.responsavel !== responsavel) continue
    if (l.mes_referencia > mesAlvo) continue
    if (!melhor || l.mes_referencia > melhor.mes_referencia) melhor = l
  }
  if (!melhor) return null
  return { valor: Number(melhor.valor ?? 0), mesOrigem: melhor.mes_referencia }
}
