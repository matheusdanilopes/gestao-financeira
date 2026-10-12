// O que ainda vai cair na fatura do NuBank principal, por responsável: assinaturas
// ativas que não apareceram na fatura do mês e compras previstas (reservas) que
// ainda não viraram compra. Compartilhado entre o Dashboard (barra e "Restante" de
// cada pessoa) e o saldo do mês (lib/faturaEfetiva), para que o "Saldo atual" e os
// blocos da fatura descontem exatamente os mesmos valores.

import { endOfMonth, format } from 'date-fns'
import { identificarAssinaturasNaFatura, type IdentificacaoAssinatura } from '@/lib/assinaturaMatch'
import { valorEfetivoNoMes, type HistoricoValorEntry } from '@/lib/assinaturaValor'
import {
  calcularReservasDoMes,
  mesReferenciaISO,
  pendentePorResponsavel,
  type BaixaReserva,
  type ReservaFatura,
  type TransacaoParaReserva,
} from '@/lib/reservasFatura'

export interface AssinaturaPendenteRow {
  id: string
  nome: string
  valor: number
  responsavel: string
  ativa: boolean
  moeda: string
  dia_cobranca?: number | null
}

export interface TransacaoPendenteRow {
  valor: number
  responsavel: string | null
  descricao: string | null
  status?: string | null
  data_compra?: string | null
  data?: string | null
  parcela_atual?: number | null
  total_parcelas?: number | null
}

export interface PendentesFaturaInput {
  mes: Date
  assinaturas: AssinaturaPendenteRow[]
  historico: HistoricoValorEntry[]
  /** Transações da fatura do principal no mês (estornos são ignorados aqui). */
  transacoes: TransacaoPendenteRow[]
  reservas: ReservaFatura[]
  baixas: BaixaReserva[]
  /** Parcelas projetadas numa fatura ainda sem lançamentos: abatem as reservas
   *  para a parcela de uma compra prevista já feita não contar duas vezes. */
  parcelasProjetadas?: TransacaoParaReserva[]
}

export interface PendentesFatura {
  assinaturasAtivas: AssinaturaPendenteRow[]
  identificacao: Map<string, IdentificacaoAssinatura<TransacaoPendenteRow>>
  /** Valor da assinatura vigente no mês (respeita o histórico de preços). */
  valorAssinatura: (a: AssinaturaPendenteRow) => number
  assinaturasNaoPagas: Record<string, number>
  reservasPendentes: Record<string, number>
  /** Assinaturas + reservas por responsável — o que ainda vai cair na fatura. */
  total: Record<string, number>
}

export function calcularPendentesFatura(input: PendentesFaturaInput): PendentesFatura {
  const assinaturasAtivas = input.assinaturas.filter(a => a.ativa)
  // Mesmo cutoff da tela de Assinaturas: o fim do mês exibido.
  const cutoff = format(endOfMonth(input.mes), 'yyyy-MM-dd')
  const valorAssinatura = (a: AssinaturaPendenteRow) =>
    valorEfetivoNoMes(a.id, a.valor, cutoff, input.historico)

  // Estornos (créditos) e compras já estornadas não são cobrança de assinatura
  // nem abatem reserva.
  const transacoes = input.transacoes.filter(t => t.status !== 'ESTORNO' && t.status !== 'ESTORNADO')

  // A data pode não vir no select; sem ela a proximidade do dia de cobrança só não
  // entra na decisão — valor, parcelamento e exclusividade continuam valendo.
  const identificacao = identificarAssinaturasNaFatura(
    assinaturasAtivas.map(a => ({
      id: a.id,
      nome: a.nome,
      moeda: a.moeda,
      diaCobranca: a.dia_cobranca ?? null,
      valorEsperado: valorAssinatura(a),
    })),
    transacoes.map(t => ({
      ...t,
      dataCompra: t.data_compra ?? t.data ?? null,
      parcelaAtual: t.parcela_atual ?? null,
      totalParcelas: t.total_parcelas ?? null,
    })),
  )

  const assinaturasNaoPagas: Record<string, number> = {}
  for (const a of assinaturasAtivas) {
    if (identificacao.get(a.id)?.status !== 'nao_encontrada') continue
    assinaturasNaoPagas[a.responsavel] = (assinaturasNaoPagas[a.responsavel] ?? 0) + valorAssinatura(a)
  }

  const reservasPendentes = pendentePorResponsavel(calcularReservasDoMes(
    input.reservas,
    input.baixas,
    [...transacoes, ...(input.parcelasProjetadas ?? [])],
    mesReferenciaISO(input.mes),
  ))

  const total: Record<string, number> = {}
  for (const mapa of [assinaturasNaoPagas, reservasPendentes]) {
    for (const [responsavel, valor] of Object.entries(mapa)) {
      total[responsavel] = (total[responsavel] ?? 0) + valor
    }
  }

  return { assinaturasAtivas, identificacao, valorAssinatura, assinaturasNaoPagas, reservasPendentes, total }
}
