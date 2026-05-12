import { parseISO, startOfDay, addDays, isSameDay } from 'date-fns'

export type StatusVencimento = 'Paga' | 'Atrasada' | 'Pendente'

/**
 * RN03 — Calcula o status de vencimento de uma despesa:
 * - com data_pagamento → 'Paga'
 * - sem data_pagamento e vencimento < hoje → 'Atrasada'
 * - demais casos → 'Pendente'
 */
export function calcularStatusVencimento(
  dataPagamento: string | null | undefined,
  dataVencimento: string | null | undefined,
  hoje: Date = new Date()
): StatusVencimento {
  if (dataPagamento) return 'Paga'
  if (dataVencimento) {
    const venc = startOfDay(parseISO(dataVencimento))
    if (venc < startOfDay(hoje)) return 'Atrasada'
  }
  return 'Pendente'
}

interface ItemComVencimento {
  item: string
  data_vencimento: string | null
  data_pagamento: string | null
}

/**
 * RN04 — Identifica despesas que vencem hoje ou amanhã (não quitadas).
 * Usado para exibir alertas inline e para o endpoint de notificações push.
 */
export function verificarVencimentos<T extends ItemComVencimento>(
  itens: T[],
  hoje: Date = new Date()
): { hoje: T[]; amanha: T[] } {
  const hojeStart = startOfDay(hoje)
  const amanhaStart = addDays(hojeStart, 1)
  return {
    hoje: itens.filter(
      (i) =>
        !i.data_pagamento &&
        i.data_vencimento &&
        isSameDay(parseISO(i.data_vencimento), hojeStart)
    ),
    amanha: itens.filter(
      (i) =>
        !i.data_pagamento &&
        i.data_vencimento &&
        isSameDay(parseISO(i.data_vencimento), amanhaStart)
    ),
  }
}
