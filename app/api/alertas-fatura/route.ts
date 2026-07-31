import { NextRequest, NextResponse } from 'next/server'
import { format, startOfMonth, addMonths, addDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { requireAuth } from '@/lib/serverAuth'
import { calcularDataFechamentoDaFatura } from '@/lib/fatura'
import { readInsightsCache } from '@/lib/ai/insightsCache'
import type { InsightItem } from '@/lib/insightsTypes'

const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Conjunto'] as const

export interface AlertasFaturaResponse {
  parcelamento: {
    percentual: number | null
    comprometido: number
    limite: number
    falta: number
  }
  fatura: {
    percentual: number | null
    gasto: number
    previsto: number
    dataFechamento: string
    diasAteFechar: number
    dataVencimento: string
    diasAteVencimento: number
  }
  insights: InsightItem[]
}

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const hoje = new Date()
    const mesRef = format(startOfMonth(hoje), 'yyyy-MM-dd')
    const mesRefFaturaDate = startOfMonth(addMonths(hoje, 1))
    const mesRefFatura = format(mesRefFaturaDate, 'yyyy-MM-dd')

    const [
      { data: limitesData },
      { data: transacoesFatura },
      { data: planejadosParcelados },
      { data: planejamentoMes },
      { data: nubankConfigs },
      { data: faturaRegistradaData },
      cache,
    ] = await Promise.all([
      supabase
        .from('limites_parcelamentos')
        .select('mes_referencia, responsavel, valor')
        .lte('mes_referencia', mesRef)
        .order('mes_referencia', { ascending: false }),
      supabase
        .from('transacoes_nubank')
        .select('valor, responsavel, total_parcelas')
        .eq('cartao', 'nubank')
        .eq('projeto_fatura', mesRefFatura)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO'),
      supabase
        .from('planejamento')
        .select('valor_previsto, responsavel, total_parcelas')
        .eq('mes_referencia', mesRef)
        .gt('total_parcelas', 1),
      supabase
        .from('planejamento')
        .select('item, valor_previsto')
        .eq('mes_referencia', mesRef),
      supabase.from('configuracoes').select('chave, valor').in('chave', ['dia_vencimento', 'ajuste_fechamento']),
      supabase.from('faturas').select('data_fechamento').eq('cartao', 'nubank').eq('mes_referencia', mesRefFatura).limit(1),
      readInsightsCache(),
    ])

    // Limite efetivo por responsável: primeiro registro (mais recente) já ordenado desc —
    // herda o valor do mês anterior configurado quando o mês corrente não tem o seu próprio.
    const limiteEfetivo: Record<string, number> = {}
    for (const l of limitesData ?? []) {
      const resp = String(l.responsavel ?? '')
      if (!resp || limiteEfetivo[resp] !== undefined) continue
      limiteEfetivo[resp] = Number(l.valor ?? 0)
    }
    const limite = RESPONSAVEIS.reduce((soma, r) => soma + (limiteEfetivo[r] ?? 0), 0)

    const comprometidoTransacoes = (transacoesFatura ?? [])
      .filter(t => Number(t.total_parcelas ?? 0) > 1)
      .reduce((soma, t) => soma + Number(t.valor ?? 0), 0)
    const comprometidoPlanejado = (planejadosParcelados ?? [])
      .reduce((soma, p) => soma + Number(p.valor_previsto ?? 0), 0)
    const comprometido = comprometidoTransacoes + comprometidoPlanejado

    const pctParcelamento = limite > 0 ? (comprometido / limite) * 100 : null
    const falta = limite - comprometido

    const gasto = (transacoesFatura ?? []).reduce((soma, t) => soma + Number(t.valor ?? 0), 0)

    const findPrevisto = (nome: string) =>
      Number((planejamentoMes ?? []).find(p => String(p.item ?? '').trim().toLowerCase() === nome)?.valor_previsto ?? 0)
    const previsto =
      findPrevisto('nubank matheus') +
      findPrevisto('nubank jeniffer') +
      findPrevisto('nubank jeniffer conjunto') +
      findPrevisto('nubank conjunto')

    const pctGasto = previsto > 0 ? (gasto / previsto) * 100 : null

    const diaVencimento = parseInt(nubankConfigs?.find(c => c.chave === 'dia_vencimento')?.valor || '10')
    const ajusteFechamento = parseInt(nubankConfigs?.find(c => c.chave === 'ajuste_fechamento')?.valor || '0')
    const dataFechamento =
      faturaRegistradaData?.[0]?.data_fechamento ||
      format(calcularDataFechamentoDaFatura(mesRefFaturaDate, diaVencimento, ajusteFechamento), 'yyyy-MM-dd')
    const dataFechamentoDate = parseISO(dataFechamento)
    const diasAteFechar = differenceInCalendarDays(dataFechamentoDate, hoje)
    const dataVencimentoDate = addDays(dataFechamentoDate, 7)
    const dataVencimento = format(dataVencimentoDate, 'yyyy-MM-dd')
    const diasAteVencimento = differenceInCalendarDays(dataVencimentoDate, hoje)

    const insights = (cache?.insights ?? []).filter(i => i.nivel === 'alerta').slice(0, 3)

    const response: AlertasFaturaResponse = {
      parcelamento: { percentual: pctParcelamento, comprometido, limite, falta },
      fatura: { percentual: pctGasto, gasto, previsto, dataFechamento, diasAteFechar, dataVencimento, diasAteVencimento },
      insights,
    }

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Falha ao calcular alertas da fatura', details: msg }, { status: 500 })
  }
}
