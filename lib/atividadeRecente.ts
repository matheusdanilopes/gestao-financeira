// Insights do "agora" para os destaques do Dashboard: quanto cada pessoa
// gastou nos últimos dias, a maior compra da semana e o ritmo comparado à
// semana anterior. Usa a data da compra (não o mês da fatura), então só faz
// sentido para o mês corrente.

import { format, subDays, startOfDay } from 'date-fns'
import { extrairParcela } from './parcelaDescricao'

export interface TransacaoRecenteRow {
  data_compra: string | null
  valor: number
  responsavel: string | null
  descricao: string | null
  status: string | null
  parcela_atual: number | null
  total_parcelas: number | null
}

export interface GastoPessoa {
  responsavel: string
  total: number
  compras: number
}

export interface AtividadeRecente {
  /** Janela curta (últimos 3 dias, contando hoje). */
  dias: number
  porPessoa: GastoPessoa[]
  totalJanela: number
  comprasJanela: number
  /** Média diária dos 27 dias anteriores à janela; 0 sem histórico. */
  mediaDiariaAnterior: number
  maiorCompraSemana: { descricao: string; valor: number; responsavel: string; data: string } | null
  totalSemana: number
  totalSemanaAnterior: number
}

export const DIAS_HISTORICO = 30
const DIAS_JANELA = 3

/** Compra que de fato aconteceu no dia: tira estornos, créditos e parcelas 2+ (a data delas é a da compra original). */
function ehCompraNova(t: TransacaoRecenteRow): boolean {
  if (t.status === 'ESTORNO' || t.status === 'ESTORNADO') return false
  if (!(t.valor > 0) || !t.data_compra) return false
  const parcela = extrairParcela(t.descricao, t.parcela_atual, t.total_parcelas)
  return !parcela || parcela.atual === 1
}

export function resumirAtividadeRecente(transacoes: TransacaoRecenteRow[], hoje: Date = new Date()): AtividadeRecente {
  const dia = (n: number) => format(subDays(startOfDay(hoje), n), 'yyyy-MM-dd')
  const hojeStr = dia(0)
  const inicioJanela = dia(DIAS_JANELA - 1)
  const inicioSemana = dia(6)
  const inicioSemanaAnterior = dia(13)
  const inicioHistorico = dia(DIAS_HISTORICO - 1)

  const porPessoa = new Map<string, GastoPessoa>()
  let totalJanela = 0, comprasJanela = 0, totalAnterior = 0, totalSemana = 0, totalSemanaAnterior = 0
  let maior: AtividadeRecente['maiorCompraSemana'] = null

  for (const t of transacoes) {
    if (!ehCompraNova(t)) continue
    const data = t.data_compra!.slice(0, 10)
    if (data > hojeStr || data < inicioHistorico) continue
    const valor = Number(t.valor)
    const resp = t.responsavel || 'Sem responsável'

    if (data >= inicioJanela) {
      totalJanela += valor
      comprasJanela++
      const p = porPessoa.get(resp) ?? { responsavel: resp, total: 0, compras: 0 }
      p.total += valor
      p.compras++
      porPessoa.set(resp, p)
    } else {
      totalAnterior += valor
    }

    if (data >= inicioSemana) {
      totalSemana += valor
      if (!maior || valor > maior.valor) {
        maior = { descricao: (t.descricao || 'Compra').trim(), valor, responsavel: resp, data }
      }
    } else if (data >= inicioSemanaAnterior) {
      totalSemanaAnterior += valor
    }
  }

  return {
    dias: DIAS_JANELA,
    porPessoa: [...porPessoa.values()].sort((a, b) => b.total - a.total),
    totalJanela,
    comprasJanela,
    mediaDiariaAnterior: totalAnterior / (DIAS_HISTORICO - DIAS_JANELA),
    maiorCompraSemana: maior,
    totalSemana,
    totalSemanaAnterior,
  }
}

/** Primeiro dia que precisa vir do banco para `resumirAtividadeRecente`. */
export function inicioHistoricoRecente(hoje: Date = new Date()): string {
  return format(subDays(startOfDay(hoje), DIAS_HISTORICO - 1), 'yyyy-MM-dd')
}
