import { format, startOfMonth, subMonths } from 'date-fns'

export type TransacaoRowParcelamento = {
  descricao?: string | null
  item?: string | null
  parcela_atual?: number | string | null
  total_parcelas?: number | string | null
  projeto_fatura?: string | null
  data_compra?: string | null
  data?: string | null
  cartao?: string | null
  responsavel?: string | null
  valor?: number | null
  [key: string]: unknown
}

export type PlanejamentoRowParcelamento = {
  item?: string | null
  responsavel?: string | null
  valor_previsto?: number | null
  categoria?: string | null
  parcela_atual?: number | string | null
  total_parcelas?: number | string | null
  mes_referencia?: string | null
  [key: string]: unknown
}

export function extrairParcelamento(
  t: TransacaoRowParcelamento | PlanejamentoRowParcelamento,
): { atual: number; total: number } | null {
  if (t.parcela_atual && t.total_parcelas) {
    const atual = Number(t.parcela_atual)
    const total = Number(t.total_parcelas)
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const descricao = String(t.descricao || t.item || '')
  const matchParcela = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (matchParcela) {
    const atual = Number(matchParcela[1])
    const total = Number(matchParcela[2])
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const matchSlash = descricao.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (matchSlash) {
    const atual = Number(matchSlash[1])
    const total = Number(matchSlash[2])
    if (atual >= 1 && total >= atual && total >= 2) return { atual, total }
  }
  return null
}

/**
 * Reconstrói "um contrato por compra parcelada" a partir de um snapshot de
 * transacoes_nubank (tipicamente só a fatura mais recente de cada cartão).
 * Limitação conhecida: uma parcela cuja última ocorrência não está no snapshot
 * fornecido (ex: fatura mais recente sem essa compra por lacuna de importação)
 * não é reconstruída — o chamador é responsável por fornecer um snapshot que
 * cubra a fatura mais recente de cada cartão.
 */
export function buildContracts(transacoes: TransacaoRowParcelamento[]) {
  const map = new Map<string, { row: TransacaoRowParcelamento; fatura: Date; parcela: { atual: number; total: number } }>()

  for (const t of transacoes) {
    const parcela = extrairParcelamento(t)
    if (!parcela) continue

    const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data || ''))
    const origem = subMonths(fatura, parcela.atual - 1)
    const descBase = String(t.descricao || '')
      .replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '')
      .trim()
      .toLowerCase()
    const cartao = t.cartao || 'nubank'
    // Inclui o valor na chave: duas compras distintas podem ter descrição, total de
    // parcelas, responsável e mês de origem idênticos, mas o valor cobrado as diferencia.
    const key = `${cartao}|${format(origem, 'yyyy-MM')}|${descBase}|${parcela.total}|${t.responsavel}|${Number(t.valor ?? 0).toFixed(2)}`

    const existing = map.get(key)
    if (!existing || fatura > existing.fatura) {
      map.set(key, { row: t, fatura, parcela })
    }
  }

  return map
}

export function buildContratosExtras(planejamentos: PlanejamentoRowParcelamento[]) {
  const map = new Map<string, { row: PlanejamentoRowParcelamento; mesRef: Date; parcela: { atual: number; total: number } }>()

  for (const e of planejamentos) {
    const parcela = extrairParcelamento({ ...e, descricao: e.item })
    if (!parcela) continue

    const mesRef = startOfMonth(new Date(e.mes_referencia || ''))
    const origem = subMonths(mesRef, parcela.atual - 1)
    const descBase = String(e.item || '')
      .replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '')
      .trim()
      .toLowerCase()
    const key = `${format(origem, 'yyyy-MM')}|${descBase}|${parcela.total}|${e.responsavel || ''}|${Number(e.valor_previsto ?? 0).toFixed(2)}`

    const existing = map.get(key)
    if (!existing || mesRef > existing.mesRef) {
      map.set(key, { row: e, mesRef, parcela })
    }
  }

  return map
}
