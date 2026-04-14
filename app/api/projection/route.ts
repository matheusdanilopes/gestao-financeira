import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth, subMonths } from 'date-fns'

const PROJECAO_OFFSET_MESES = 1

function extrairParcelamento(t: any): { atual: number; total: number } | null {
  const descricao = String(t.descricao || '')
  if (!/parcela/i.test(descricao)) return null
  if (t.parcela_atual && t.total_parcelas) {
    const atual = Number(t.parcela_atual)
    const total = Number(t.total_parcelas)
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const match = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (!match) return null
  const atual = Number(match[1])
  const total = Number(match[2])
  if (atual >= 1 && total >= atual) return { atual, total }
  return null
}

/**
 * Para cada série de parcelamento, guarda apenas a linha mais recente do banco
 * (maior projeto_fatura). Isso garante que a projeção parta do estado atual
 * de cada contrato, sem reprocessar linhas antigas da mesma série.
 */
function buildContracts(transacoes: any[]) {
  const map = new Map<string, { row: any; fatura: Date; parcela: { atual: number; total: number } }>()

  for (const t of transacoes) {
    const parcela = extrairParcelamento(t)
    if (!parcela) continue

    const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
    const origem = subMonths(fatura, parcela.atual - 1)
    const descBase = String(t.descricao || '')
      .replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '')
      .trim()
      .toLowerCase()
    const key = `${format(origem, 'yyyy-MM')}|${descBase}|${parcela.total}|${t.responsavel}`

    const existing = map.get(key)
    if (!existing || fatura > existing.fatura) {
      map.set(key, { row: t, fatura, parcela })
    }
  }

  return map
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

    const contratos = buildContracts(todasTransacoes || [])

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(inicioProjecao, i))

      for (const { row, fatura, parcela } of contratos.values()) {
        // Qual parcela cai neste mês de projeção?
        const deltaM = (mesRef.getFullYear() - fatura.getFullYear()) * 12 +
          (mesRef.getMonth() - fatura.getMonth())
        const parcelaNoMes = parcela.atual + deltaM

        if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
          resultados.total[i] += row.valor
          if (row.responsavel === 'Matheus') resultados.matheus[i] += row.valor
          else if (row.responsavel === 'Jeniffer') resultados.jeniffer[i] += row.valor
        }
      }

      const mesStr = format(mesRef, 'yyyy-MM-dd')
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
