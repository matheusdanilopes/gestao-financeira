import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth } from 'date-fns'

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { meses } = await req.json()
    const hoje = new Date()
    const resultados = {
      total: new Array(meses.length).fill(0),
      matheus: new Array(meses.length).fill(0),
      jeniffer: new Array(meses.length).fill(0),
      extra: new Array(meses.length).fill(0),
    }

    const { data: transacoes } = await supabase.from('transacoes_nubank').select('*')
    const { data: extras } = await supabase.from('planejamento').select('*').eq('categoria', 'Extra')

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(hoje, i))
      const mesStr = format(mesRef, 'yyyy-MM-dd')

      for (const t of (transacoes || [])) {
        const dataTransacao = new Date(t.data)
        const mesTransacao = startOfMonth(dataTransacao)
        const mesesDiff =
          (mesRef.getMonth() - mesTransacao.getMonth()) +
          (mesRef.getFullYear() - mesTransacao.getFullYear()) * 12

        if (t.parcela_atual && t.total_parcelas) {
          const parcelasRestantes = t.total_parcelas - t.parcela_atual + 1
          if (mesesDiff >= 0 && mesesDiff < parcelasRestantes) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        } else {
          const projetoFaturaStr = typeof t.projeto_fatura === 'string'
            ? t.projeto_fatura.substring(0, 10)
            : format(new Date(t.projeto_fatura), 'yyyy-MM-dd')
          if (mesStr === projetoFaturaStr) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        }
      }

      for (const e of (extras || [])) {
        if (e.parcela_atual && e.total_parcelas) {
          const mesExtra = startOfMonth(new Date(e.mes_referencia))
          const mesesDiff =
            (mesRef.getMonth() - mesExtra.getMonth()) +
            (mesRef.getFullYear() - mesExtra.getFullYear()) * 12
          const parcelasRestantes = e.total_parcelas - e.parcela_atual + 1
          if (mesesDiff >= 0 && mesesDiff < parcelasRestantes) {
            resultados.extra[i] += e.valor_previsto
            resultados.total[i] += e.valor_previsto
          }
        } else {
          const mesExtraStr = typeof e.mes_referencia === 'string'
            ? e.mes_referencia.substring(0, 10)
            : format(new Date(e.mes_referencia), 'yyyy-MM-dd')
          if (mesStr === mesExtraStr) {
            resultados.extra[i] += e.valor_previsto
            resultados.total[i] += e.valor_previsto
          }
        }
      }
    }

    return NextResponse.json(resultados)
  } catch (error) {
    console.error('[projection] Erro:', error)
    return NextResponse.json({ error: 'Erro na projecao' }, { status: 500 })
  }
}
