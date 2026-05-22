// Pre-computes financial metrics from raw data to avoid raw data dumps to AI

import { format, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type {
  EnrichedData,
  FinancialInsightsContext,
  CategoryMetric,
  Transacao,
} from './types'

const fmtMes = (yyyyMM: string) => {
  try {
    return format(new Date(yyyyMM + '-02'), 'MMM/yyyy', { locale: ptBR }).toUpperCase()
  } catch {
    return yyyyMM
  }
}

function sumValor(lista: Transacao[]) {
  return lista.reduce((a, t) => a + t.valor, 0)
}

function topCategories(lista: Transacao[], total: number, n = 6): CategoryMetric[] {
  const acc: Record<string, number> = {}
  for (const t of lista) {
    const cat = t.categoria || 'Sem categoria'
    acc[cat] = (acc[cat] ?? 0) + t.valor
  }
  return Object.entries(acc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([categoria, valor]) => ({
      categoria,
      valor,
      percentual: total > 0 ? (valor / total) * 100 : 0,
    }))
}

export function computeInsights(data: EnrichedData): FinancialInsightsContext {
  const hoje = new Date()
  const mesAtual = format(hoje, 'yyyy-MM')
  const mesAnterior = format(subMonths(hoje, 1), 'yyyy-MM')

  // Group transactions by bill month
  const byMes: Record<string, Transacao[]> = {}
  for (const t of data.transacoes) {
    const m = (t.projeto_fatura ?? '').substring(0, 7)
    if (!byMes[m]) byMes[m] = []
    byMes[m].push(t)
  }

  const txAtual = byMes[mesAtual] ?? []
  const txAnterior = byMes[mesAnterior] ?? []

  const totalGastos = sumValor(txAtual)
  const totalGastosAnterior = sumValor(txAnterior)
  const variacaoGastos =
    totalGastosAnterior > 0
      ? ((totalGastos - totalGastosAnterior) / totalGastosAnterior) * 100
      : 0

  // Spending by person
  const gastoMatheus = sumValor(txAtual.filter(t => t.responsavel === 'Matheus'))
  const gastoJeniffer = sumValor(txAtual.filter(t => t.responsavel === 'Jeniffer'))

  // Top categories with month-over-month comparison
  const catsAtual: Record<string, number> = {}
  const catsAnterior: Record<string, number> = {}
  for (const t of txAtual) {
    const cat = t.categoria || 'Sem categoria'
    catsAtual[cat] = (catsAtual[cat] ?? 0) + t.valor
  }
  for (const t of txAnterior) {
    const cat = t.categoria || 'Sem categoria'
    catsAnterior[cat] = (catsAnterior[cat] ?? 0) + t.valor
  }

  const topCategorias: CategoryMetric[] = Object.entries(catsAtual)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([categoria, valor]) => {
      const anterior = catsAnterior[categoria] ?? 0
      const variacao = anterior > 0 ? ((valor - anterior) / anterior) * 100 : undefined
      return {
        categoria,
        valor,
        percentual: totalGastos > 0 ? (valor / totalGastos) * 100 : 0,
        anterior: anterior || undefined,
        variacao,
      }
    })

  // Biggest individual purchases this month
  const maioresGastos = [...txAtual]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
    .map(t => ({
      descricao: t.descricao,
      valor: t.valor,
      categoria: t.categoria ?? 'Sem categoria',
      responsavel: t.responsavel,
      cartao: t.cartao ?? 'nubank',
    }))

  // Spending by card
  const gastoPorCartao: Record<string, number> = {}
  for (const t of txAtual) {
    const cartao = t.cartao ?? 'nubank'
    gastoPorCartao[cartao] = (gastoPorCartao[cartao] ?? 0) + t.valor
  }

  // Installment purchases this month
  const parceladas = txAtual.filter(t => t.total_parcelas && t.total_parcelas > 1)
  const comprasParceladas = {
    count: parceladas.length,
    totalValor: sumValor(parceladas),
  }

  // Subscriptions
  const assinaturasAtivas = data.assinaturas.filter(a => a.ativa)
  const totalAssinaturas = assinaturasAtivas.reduce((s, a) => s + a.valor, 0)
  const assinaturasPorCategoria: Record<string, number> = {}
  for (const a of assinaturasAtivas) {
    assinaturasPorCategoria[a.categoria] = (assinaturasPorCategoria[a.categoria] ?? 0) + a.valor
  }

  // Planning for current month
  const planAtual = data.planejamento.filter(
    p => (p.mes_referencia ?? '').substring(0, 7) === mesAtual
  )
  const totalOrcado = planAtual.reduce((s, p) => s + p.valor_previsto, 0)
  const totalPago = planAtual
    .filter(p => p.data_pagamento)
    .reduce((s, p) => s + p.valor_previsto, 0)
  const despesasEmAberto = totalOrcado - totalPago
  const itensPlanejamentoEmAberto = planAtual
    .filter(p => !p.data_pagamento)
    .sort((a, b) => {
      if (a.data_vencimento && b.data_vencimento) return a.data_vencimento.localeCompare(b.data_vencimento)
      return 0
    })
    .slice(0, 5)
    .map(p => ({
      item: p.item,
      valor: p.valor_previsto,
      vencimento: p.data_vencimento ?? undefined,
    }))

  // Investments
  const totalAportesHistorico = data.aportes.reduce((s, a) => s + a.valor, 0)
  const aportesRecentes = [...data.aportes]
    .sort((a, b) => b.data_aporte.localeCompare(a.data_aporte))
    .slice(0, 5)
    .map(a => {
      const inv = data.investimentos.find(i => i.id === a.investimento_id)
      return {
        descricao: inv?.descricao ?? 'Investimento',
        valor: a.valor,
        data: a.data_aporte,
      }
    })

  // Historical average (last 6 months excluding current)
  const meses6 = Array.from({ length: 6 }, (_, i) =>
    format(subMonths(hoje, i + 1), 'yyyy-MM')
  )
  const totaisMeses6 = meses6.map(m => sumValor(byMes[m] ?? []))
  const mediaMensalHistorica =
    totaisMeses6.filter(v => v > 0).length > 0
      ? totaisMeses6.reduce((s, v) => s + v, 0) /
        totaisMeses6.filter(v => v > 0).length
      : 0

  // Trend: last 3 months vs 3 months before
  const u3 = meses6.slice(0, 3).map(m => sumValor(byMes[m] ?? []))
  const a3 = meses6.slice(3, 6).map(m => sumValor(byMes[m] ?? []))
  const mediaU3 = u3.reduce((s, v) => s + v, 0) / 3
  const mediaA3 = a3.reduce((s, v) => s + v, 0) / 3
  const tendenciaPct = mediaA3 > 0 ? ((mediaU3 - mediaA3) / mediaA3) * 100 : 0
  const tendencia =
    Math.abs(tendenciaPct) < 5 ? 'estavel' : tendenciaPct > 0 ? 'alta' : 'baixa'

  return {
    mesAtual: fmtMes(mesAtual),
    mesAnterior: fmtMes(mesAnterior),
    totalGastos,
    totalGastosAnterior,
    variacaoGastos,
    gastoMatheus,
    gastoJeniffer,
    topCategorias,
    maioresGastos,
    gastoPorCartao,
    comprasParceladas,
    totalAssinaturas,
    assinaturasAtivas: assinaturasAtivas.length,
    assinaturasPorCategoria,
    totalOrcado,
    totalPago,
    despesasEmAberto,
    itensPlanejamentoEmAberto,
    totalAportesHistorico,
    aportesRecentes,
    mediaMensalHistorica,
    tendencia,
    tendenciaPct,
  }
}

export function formatInsightsAsText(ins: FinancialInsightsContext): string {
  const fmtR = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
  const signPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  const tendStr =
    ins.tendencia === 'estavel'
      ? 'estável'
      : ins.tendencia === 'alta'
      ? `↑ em alta (${signPct(ins.tendenciaPct)} últimos 3m vs anteriores)`
      : `↓ em queda (${signPct(ins.tendenciaPct)} últimos 3m vs anteriores)`

  let out = `\nMÉTRICAS FINANCEIRAS — ${ins.mesAtual}\n`
  out += `${'─'.repeat(50)}\n`

  out += `GASTOS DO MÊS: ${fmtR(ins.totalGastos)}`
  if (ins.totalGastosAnterior > 0) {
    out += ` (${signPct(ins.variacaoGastos)} vs ${ins.mesAnterior}: ${fmtR(ins.totalGastosAnterior)})`
  }
  out += `\n`
  out += `  Matheus: ${fmtR(ins.gastoMatheus)} | Jeniffer: ${fmtR(ins.gastoJeniffer)}\n`

  if (Object.keys(ins.gastoPorCartao).length > 1) {
    out += `  Por cartão: ${Object.entries(ins.gastoPorCartao).map(([c, v]) => `${c} ${fmtR(v)}`).join(' | ')}\n`
  }

  out += `\nTOP CATEGORIAS:\n`
  for (const cat of ins.topCategorias) {
    const varStr = cat.variacao !== undefined ? ` (${signPct(cat.variacao)} vs ant)` : ''
    out += `  ${cat.categoria}: ${fmtR(cat.valor)} (${cat.percentual.toFixed(0)}%${varStr})\n`
  }

  out += `\nMAIORES COMPRAS:\n`
  for (const g of ins.maioresGastos) {
    const cartaoLabel = g.cartao !== 'nubank' ? ` {${g.cartao}}` : ''
    out += `  ${g.responsavel[0]} ${g.descricao}${cartaoLabel} — ${fmtR(g.valor)} [${g.categoria}]\n`
  }

  if (ins.comprasParceladas.count > 0) {
    out += `\nPARCELAMENTOS ATIVOS: ${ins.comprasParceladas.count} parcelas (${fmtR(ins.comprasParceladas.totalValor)} este mês)\n`
  }

  if (ins.assinaturasAtivas > 0) {
    out += `\nASSINATURAS: ${fmtR(ins.totalAssinaturas)}/mês em ${ins.assinaturasAtivas} serviços ativos\n`
    const cats = Object.entries(ins.assinaturasPorCategoria).sort((a, b) => b[1] - a[1])
    if (cats.length > 0) {
      out += `  Por categoria: ${cats.map(([c, v]) => `${c} ${fmtR(v)}`).join(' | ')}\n`
    }
  }

  if (ins.totalOrcado > 0) {
    const pctPago = ins.totalOrcado > 0 ? (ins.totalPago / ins.totalOrcado) * 100 : 0
    out += `\nPLANEJAMENTO (${ins.mesAtual}): orçado ${fmtR(ins.totalOrcado)} | pago ${fmtR(ins.totalPago)} (${pctPago.toFixed(0)}%)`
    if (ins.despesasEmAberto > 0) out += ` | em aberto ${fmtR(ins.despesasEmAberto)}`
    out += `\n`
    if (ins.itensPlanejamentoEmAberto.length > 0) {
      out += `  Pendentes: ${ins.itensPlanejamentoEmAberto.map(i => `${i.item} ${fmtR(i.valor)}`).join(', ')}\n`
    }
  }

  if (ins.totalAportesHistorico > 0) {
    out += `\nINVESTIMENTOS: ${fmtR(ins.totalAportesHistorico)} total histórico aportado\n`
    if (ins.aportesRecentes.length > 0) {
      out += `  Recentes: ${ins.aportesRecentes.map(a => `${a.descricao} ${fmtR(a.valor)}`).join(', ')}\n`
    }
  }

  if (ins.mediaMensalHistorica > 0) {
    out += `\nMÉDIA HISTÓRICA: ${fmtR(ins.mediaMensalHistorica)}/mês (últimos 6 meses)\n`
    out += `TENDÊNCIA: ${tendStr}\n`
  }

  return out
}
