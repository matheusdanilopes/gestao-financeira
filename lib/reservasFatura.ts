// Reservas na fatura (tela "Compras previstas"): valores separados para compras que
// ainda vão cair na fatura do NuBank principal — pontuais, parceladas ou recorrentes. Compartilhado entre o Dashboard
// (desconto no "Restante" de cada pessoa) e a tela de Reservas, para que os dois
// mostrem exatamente o mesmo valor pendente.
//
// Para não contar a mesma despesa duas vezes, a reserva só desconta o que ainda
// NÃO virou compra: compras da fatura cuja descrição contém uma das palavras-chave
// abatem a reserva, e a baixa manual ("já caiu") zera o pendente daquele mês.

import { addMonths, differenceInCalendarMonths, format, parseISO, startOfMonth } from 'date-fns'
import { normalizarTexto } from '@/lib/assinaturaMatch'

export interface ReservaFatura {
  id: string
  descricao: string
  valor: number
  responsavel: string
  recorrente: boolean
  /** Mês de referência ('yyyy-MM-dd', dia 1) em que a reserva começa. */
  mes_inicio: string
  /** Último mês em que vale. Pontual: igual a mes_inicio. Parcelada: mês da última
   *  parcela. Recorrente: null até ser encerrada. */
  mes_fim: string | null
  palavras_chave: string | null
  /** Quantidade de parcelas (compra parcelada). `valor` é o total da compra. */
  parcelas?: number | null
  created_at?: string
}

export interface BaixaReserva {
  reserva_id: string
  mes_referencia: string
}

export interface TransacaoParaReserva {
  descricao: string | null
  valor: number
  responsavel: string | null
  status?: string | null
}

export interface ReservaCalculada {
  reserva: ReservaFatura
  /** Soma das compras da fatura que casaram com as palavras-chave. */
  consumido: number
  /** Compras que abateram a reserva (para conferência na tela). */
  compras: TransacaoParaReserva[]
  baixadaManual: boolean
  /** Mês em que a baixa manual foi registrada (numa parcelada, pode ser anterior). */
  mesBaixa: string | null
  /** Valor previsto para este mês: a parcela, numa compra parcelada. */
  valorDoMes: number
  /** Número da parcela deste mês (1 = primeira), só em compras parceladas. */
  parcelaAtual: number | null
  /** Quanto ainda falta cair na fatura — é o que sai do "Restante". */
  pendente: number
}

export function mesReferenciaISO(mes: Date): string {
  return format(startOfMonth(mes), 'yyyy-MM-dd')
}

/** Normaliza a data vinda do banco para o dia 1 do mês ('yyyy-MM-dd'). */
function mesDe(data: string): string {
  return mesReferenciaISO(parseISO(data.slice(0, 10)))
}

export function ehParcelada(reserva: ReservaFatura): boolean {
  return (reserva.parcelas ?? 0) >= 2
}

/** Valor que a reserva representa em cada mês: total ÷ parcelas numa parcelada. */
export function valorMensalDaReserva(reserva: ReservaFatura): number {
  const valor = Number(reserva.valor) || 0
  return ehParcelada(reserva) ? valor / (reserva.parcelas as number) : valor
}

/** Mês da última parcela ('yyyy-MM-dd') de uma compra parcelada iniciada em `mesInicio`. */
export function mesUltimaParcela(mesInicio: string, parcelas: number): string {
  return mesReferenciaISO(addMonths(parseISO(mesInicio.slice(0, 10)), parcelas - 1))
}

export function reservaVigenteNoMes(reserva: ReservaFatura, mesRef: string): boolean {
  if (mesDe(reserva.mes_inicio) > mesRef) return false
  if (reserva.mes_fim && mesDe(reserva.mes_fim) < mesRef) return false
  return true
}

/** Termos de busca já normalizados. Termos com menos de 3 letras são ignorados
 *  para não casar praticamente qualquer compra. */
export function termosDaReserva(palavrasChave: string | null | undefined): string[] {
  return String(palavrasChave ?? '')
    .split(/[,;\n]/)
    .map(t => normalizarTexto(t))
    .filter(t => t.length >= 3)
}

function compraCasa(descricao: string | null, termos: string[]): boolean {
  if (termos.length === 0) return false
  const texto = normalizarTexto(descricao)
  return termos.some(t => texto.includes(t))
}

/**
 * Calcula, para um mês, quanto de cada reserva vigente já caiu na fatura e quanto
 * ainda está pendente. `transacoes` são as compras da fatura do principal naquele
 * mês. Cada compra abate no máximo uma reserva (a mais antiga que casar, do mesmo
 * responsável) — duas reservas com termos parecidos não somem com a mesma compra.
 */
export function calcularReservasDoMes(
  reservas: ReservaFatura[],
  baixas: BaixaReserva[],
  transacoes: TransacaoParaReserva[],
  mesRef: string,
): ReservaCalculada[] {
  const vigentes = reservas
    .filter(r => reservaVigenteNoMes(r, mesRef))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

  // Baixa vale no próprio mês; numa parcelada, vale também para as parcelas
  // seguintes — depois de feita, a compra real segue pelas parcelas importadas
  // (e pela projeção de parcelas do Dashboard), e a previsão contaria em dobro.
  const parceladas = new Set(vigentes.filter(ehParcelada).map(r => r.id))
  const mesBaixaPorReserva = new Map<string, string>()
  for (const b of baixas) {
    const mes = mesDe(b.mes_referencia)
    const vale = mes === mesRef || (parceladas.has(b.reserva_id) && mes < mesRef)
    if (!vale) continue
    const atual = mesBaixaPorReserva.get(b.reserva_id)
    if (!atual || mes > atual) mesBaixaPorReserva.set(b.reserva_id, mes)
  }

  const resultado = vigentes.map(reserva => ({
    reserva,
    termos: termosDaReserva(reserva.palavras_chave),
    consumido: 0,
    compras: [] as TransacaoParaReserva[],
  }))

  for (const t of transacoes) {
    if (t.status === 'ESTORNO' || t.status === 'ESTORNADO') continue
    if (!(t.valor > 0)) continue
    const alvo = resultado.find(r =>
      r.reserva.responsavel === (t.responsavel || '') && compraCasa(t.descricao, r.termos)
    )
    if (!alvo) continue
    alvo.consumido += t.valor
    alvo.compras.push(t)
  }

  return resultado.map(({ reserva, consumido, compras }) => {
    const mesBaixa = mesBaixaPorReserva.get(reserva.id) ?? null
    const valorDoMes = valorMensalDaReserva(reserva)
    const parcelaAtual = ehParcelada(reserva)
      ? differenceInCalendarMonths(parseISO(mesRef), parseISO(mesDe(reserva.mes_inicio))) + 1
      : null
    return {
      reserva,
      consumido,
      compras,
      baixadaManual: mesBaixa !== null,
      mesBaixa,
      valorDoMes,
      parcelaAtual,
      pendente: mesBaixa !== null ? 0 : Math.max(0, valorDoMes - consumido),
    }
  })
}

/** Soma do pendente por responsável — o valor descontado do "Restante". */
export function pendentePorResponsavel(calculadas: ReservaCalculada[]): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const c of calculadas) {
    mapa[c.reserva.responsavel] = (mapa[c.reserva.responsavel] ?? 0) + c.pendente
  }
  return mapa
}
