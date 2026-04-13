import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth } from 'date-fns'

const PROJECAO_OFFSET_MESES = 1

function extrairParcelamento(t: any): { atual: number; total: number } | null {
  if (t.parcela_atual && t.total_parcelas) {
    return { atual: Number(t.parcela_atual), total: Number(t.total_parcelas) }
  }
  const descricao = String(t.descricao || '')
  const match = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i) || descricao.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null
  return { atual: Number(match[1]), total: Number(match[2]) }
}

function seriesKey(t: any, parcela: { atual: number; total: number }): string {
  const desc = String(t.descricao || '')
    .replace(/\s*\d+\s*\/\s*\d+/, '')
    .replace(/parcela\s*/i, '')
    .trim()
  return `${desc}|${t.valor}|${parcela.total}`
}

/** Para cada série parcelada mantém apenas a transação com menor parcela_atual */
function deduplicarParcelamentos(transacoes: any[]): any[] {
  const map = new Map<string, any>()
  for (const t of transacoes) {
    const parcela = extrairParcelamento(t)
    if (!parcela) continue
    const key = seriesKey(t, parcela)
    const existente = map.get(key)
    if (!existente || parcela.atual < extrairParcelamento(existente)!.atual) {
      map.set(key, t)
    }
  }
  return [...transacoes.filter(t => !extrairParcelamento(t)), ...Array.from(map.values())]
}

function mesOrigem(t: any): Date {
  return startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
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

    // Deduplica séries parceladas — cada série conta uma única vez por mês projetado
    const transacoes = deduplicarParcelamentos(todasTransacoes || [])

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(inicioProjecao, i))
      const mesStr = format(mesRef, 'yyyy-MM-dd')

      for (const t of transacoes) {
        const parcela = extrairParcelamento(t)

        if (parcela) {
          const origem = mesOrigem(t)
          const mesesDiff =
            (mesRef.getFullYear() - origem.getFullYear()) * 12 +
            (mesRef.getMonth() - origem.getMonth())
          const restantes = parcela.total - parcela.atual + 1
          if (mesesDiff >= 0 && mesesDiff < restantes) {
            resultados.total[i] += t.valor
            if (t.responsavel === 'Matheus') resultados.matheus[i] += t.valor
            else if (t.responsavel === 'Jeniffer') resultados.jeniffer[i] += t.valor
          }
        } else {
          const faturaStr = typeof t.projeto_fatura === 'string'
            ? t.projeto_fatura.substring(0, 10)
            : format(new Date(t.projeto_fatura), 'yyyy-MM-dd')
          if (mesStr === faturaStr) {
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
