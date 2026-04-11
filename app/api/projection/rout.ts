import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { format, addMonths, startOfMonth, endOfMonth } from 'date-fns'

export async function POST(req: NextRequest) {
  try {
    const { meses } = await req.json()
    const hoje = new Date()
    const resultados = {
      matheus: [] as number[],
      jeniffer: [] as number[],
      extras: [] as number[],
      total: [] as number[]
    }

    for (let i = 0; i < meses.length; i++) {
      const mesReferencia = startOfMonth(addMonths(hoje, i))
      const mesFormatado = format(mesReferencia, 'yyyy-MM-dd')
      const mesSeguinte = endOfMonth(mesReferencia)

      // 1. Itens do planejamento (fixos + extras)
      const { data: planejamentos } = await supabase
        .from('planejamento')
        .select('categoria, responsavel, valor_previsto')
        .eq('mes_referencia', mesFormatado)

      let somaMatheus = 0
      let somaJeniffer = 0
      let somaExtras = 0

      planejamentos?.forEach(p => {
        if (p.categoria === 'Extra') {
          somaExtras += p.valor_previsto
        } else {
          if (p.responsavel === 'Matheus') somaMatheus += p.valor_previsto
          else if (p.responsavel === 'Jeniffer') somaJeniffer += p.valor_previsto
        }
      })

      // 2. Gastos de cartão (transações importadas) projetadas para este mês
      const { data: transacoes } = await supabase
        .from('transacoes_nubank')
        .select('responsavel, valor')
        .eq('projeto_fatura', mesFormatado)

      transacoes?.forEach(t => {
        if (t.responsavel === 'Matheus') somaMatheus += t.valor
        else somaJeniffer += t.valor
      })

      resultados.matheus.push(somaMatheus)
      resultados.jeniffer.push(somaJeniffer)
      resultados.extras.push(somaExtras)
      resultados.total.push(somaMatheus + somaJeniffer + somaExtras)
    }

    return NextResponse.json(resultados)
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao gerar projeção' }, { status: 500 })
  }
}