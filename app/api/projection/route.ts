import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth, subMonths } from 'date-fns'

const PROJECAO_OFFSET_MESES = 1

function extrairParcelamento(t: any): { atual: number; total: number } | null {
  if (t.parcela_atual && t.total_parcelas) {
    const atual = Number(t.parcela_atual)
    const total = Number(t.total_parcelas)
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  return null
}

/**
 * Chave única por série: mês de origem da compra + valor + total de parcelas + responsável.
 * O mês de origem é calculado retrocedendo (parcela_atual - 1) meses a partir do projeto_fatura,
 * o que é robusto independente do texto da descrição.
 */
function seriesKey(t: any, parcela: { atual: number; total: number }): string {
  const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
  const origem = subMonths(fatura, parcela.atual - 1)
  return `${format(origem, 'yyyy-MM')}|${t.valor}|${parcela.total}|${t.responsavel}`
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

    const { data: todasTransacoes } = await supabase.from('transacoes_nubank').select('*')
    const { data: extras } = await supabase.from('planejamento').select('*').eq('categoria', 'Extra')

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(inicioProjecao, i))
      const mesStr = format(mesRef, 'yyyy-MM-dd')

      // Deduplica por série dentro de cada mês projetado
      const seriesContadas = new Set<string>()

      for (const t of (todasTransacoes || [])) {
        const parcela = extrairParcelamento(t)

        if (parcela) {
          const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
          const mesesDiff =
            (mesRef.getFullYear() - fatura.getFullYear()) * 12 +
            (mesRef.getMonth() - fatura.getMonth())
          const restantes = parcela.total - parcela.atual + 1

          if (mesesDiff >= 0 && mesesDiff < restantes) {
            const key = seriesKey(t, parcela)
            if (!seriesContadas.has(key)) {
              seriesContadas.add(key)
              resultados.total[i] += t.valor
              if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
              else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
            }
          }
        }
        // Compras avulsas (não parceladas) são ignoradas na projeção
      }

      for (const e of (extras || [])) {
        if (e.parcela_atual && e.total_parcelas) {
          const mesExtra = startOfMonth(new Date(e.mes_referencia))
          const mesesDiff =
            (mesRef.getFullYear() - mesExtra.getFullYear()) * 12 +
            (mesRef.getMonth() - mesExtra.getMonth())
          const restantes = e.total_parcelas - e.parcela_atual + 1
          if (mesesDiff >= 0 && mesesDiff < restantes) {
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
