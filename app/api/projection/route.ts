import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { format, addMonths, startOfMonth } from 'date-fns'

export async function POST(req: NextRequest) {
  try {
    const { meses } = await req.json()
    const hoje = new Date()
    const resultados = { total: new Array(meses.length).fill(0), matheus: new Array(meses.length).fill(0), jeniffer: new Array(meses.length).fill(0), extra: new Array(meses.length).fill(0) }

    const { data: transacoes } = await supabase.from('transacoes_nubank').select('*')
    const { data: extras } = await supabase.from('planejamento').select('*').eq('categoria', 'Extra')

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(hoje, i))
      const mesStr = format(mesRef, 'yyyy-MM-dd')

      // Parcelas do cartão
      for (const t of transacoes) {
        const dataTransacao = new Date(t.data)
        const mesTransacao = startOfMonth(dataTransacao)
        const mesesDiff = (mesRef.getMonth() - mesTransacao.getMonth()) + (mesRef.getFullYear() - mesTransacao.getFullYear()) * 12

        if (t.parcela_atual && t.total_parcelas) {
          if (mesesDiff >= 0 && mesesDiff < t.total_parcelas) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        } else {
          if (mesStr === t.projeto_fatura) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        }
      }

      // Débitos Extras (parcelados ou fixos)
      for (const e of extras) {
        if (e.parcela_atual && e.total_parcelas) {
          const mesesDiff = i
          if (mesesDiff >= 0 && mesesDiff < e.total_parcelas) {
            resultados.extra[i] += e.valor_previsto
            resultados.total[i] += e.valor_previsto
          }
        } else {
          if (mesStr === e.mes_referencia) {
            resultados.extra[i] += e.valor_previsto
            resultados.total[i] += e.valor_previsto
          }
        }
      }
    }
    return NextResponse.json(resultados)
  } catch (error) {
    return NextResponse.json({ error: 'Erro na projeção' }, { status: 500 })
  }
}
