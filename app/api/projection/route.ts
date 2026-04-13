import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth } from 'date-fns'

const PROJECAO_OFFSET_MESES = 2

function extrairParcelamento(t: any) {
  if (t.parcela_atual && t.total_parcelas) {
    return { atual: Number(t.parcela_atual), total: Number(t.total_parcelas) }
  }

  const descricao = String(t.descricao || '')
  const match = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i) || descricao.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null

  return { atual: Number(match[1]), total: Number(match[2]) }
}

function mesOrigemTransacao(t: any) {
  const base = t.projeto_fatura || t.data_compra || t.data
  return startOfMonth(new Date(base))
}

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { meses } = await req.json()
    const inicioProjecao = startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES))
    const resultados = {
      total: new Array(meses.length).fill(0),
      matheus: new Array(meses.length).fill(0),
      jeniffer: new Array(meses.length).fill(0),
      extra: new Array(meses.length).fill(0),
    }

    const { data: transacoes } = await supabase.from('transacoes_nubank').select('*')
    const { data: extras } = await supabase.from('planejamento').select('*').eq('categoria', 'Extra')

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(inicioProjecao, i))
      const mesStr = format(mesRef, 'yyyy-MM-dd')

      for (const t of (transacoes || [])) {
        const parcela = extrairParcelamento(t)

        if (parcela && parcela.total >= parcela.atual) {
          const mesOrigem = mesOrigemTransacao(t)
          const mesesDiff =
            (mesRef.getMonth() - mesOrigem.getMonth()) +
            (mesRef.getFullYear() - mesOrigem.getFullYear()) * 12

          const parcelasRestantes = parcela.total - parcela.atual + 1
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
