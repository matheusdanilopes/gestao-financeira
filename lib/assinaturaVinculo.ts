/**
 * Vínculo entre assinatura e lançamento da fatura.
 *
 * A detecção padrão é automática (cartão + descrição contendo o nome da
 * assinatura). Quando ela captura a compra errada, o usuário corrige o vínculo
 * manualmente e a correção fica registrada em `assinaturas_vinculos`:
 *
 *   'ignorado' → aquela transação deixa de ser considerada essa assinatura
 *   'manual'   → aquela transação passa a ser a assinatura, mesmo que a
 *                descrição não bata com o nome
 *
 * Enquanto não houver nenhum vínculo manual para a assinatura no mês, tudo
 * funciona como antes — o casamento automático continua valendo.
 */

export type TipoVinculo = 'ignorado' | 'manual'

export interface VinculoAssinatura {
  id?: string
  assinatura_id: string
  transacao_id: string
  projeto_fatura: string // 'YYYY-MM-DD' — primeiro dia do mês da fatura
  tipo: TipoVinculo
}

export interface TransacaoVinculavel {
  id: string
  descricao: string | null
  valor: number
}

export interface AssinaturaVinculavel {
  id: string
  nome: string
}

/** Casamento automático por nome: descrição da compra contém o nome da assinatura. */
export function casaPorNome(assinatura: AssinaturaVinculavel, tx: TransacaoVinculavel): boolean {
  const nome = assinatura.nome.trim().toLowerCase()
  if (!nome) return false
  return (tx.descricao || '').toLowerCase().includes(nome)
}

/** Índice transacao_id → tipo, restrito aos vínculos de uma assinatura. */
export function mapaVinculos(
  assinaturaId: string,
  vinculos: VinculoAssinatura[]
): Map<string, TipoVinculo> {
  const mapa = new Map<string, TipoVinculo>()
  for (const v of vinculos) {
    if (v.assinatura_id === assinaturaId) mapa.set(v.transacao_id, v.tipo)
  }
  return mapa
}

/**
 * Transações da fatura que correspondem a uma assinatura.
 *
 * `transacoes` já deve vir restrita ao mês da fatura em questão.
 * `candidatoAuto` é o filtro extra do casamento automático (cartão na tela de
 * assinaturas, responsável no dashboard); vínculos manuais o ignoram de
 * propósito — se o usuário apontou a compra, ela vale.
 */
export function transacoesDaAssinatura<T extends TransacaoVinculavel>(
  assinatura: AssinaturaVinculavel,
  transacoes: T[],
  vinculos: VinculoAssinatura[],
  candidatoAuto: (tx: T) => boolean = () => true
): T[] {
  const mapa = mapaVinculos(assinatura.id, vinculos)

  if (mapa.size > 0) {
    const manuais = transacoes.filter(tx => mapa.get(tx.id) === 'manual')
    if (manuais.length > 0) return manuais
  }

  return transacoes.filter(
    tx => mapa.get(tx.id) !== 'ignorado' && candidatoAuto(tx) && casaPorNome(assinatura, tx)
  )
}

/** Há alguma correção manual registrada para a assinatura no mês carregado? */
export function temVinculoManual(assinaturaId: string, vinculos: VinculoAssinatura[]): boolean {
  return vinculos.some(v => v.assinatura_id === assinaturaId)
}
