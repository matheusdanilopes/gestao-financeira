import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { addMonths, startOfMonth, subMonths, format } from 'date-fns'
import { buildContracts, buildContratosExtras } from '@/lib/parcelamentoProjecao'

const JANELA_PARCELAS_MESES = 36
const PROJECAO_OFFSET_MESES = 1

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { meses, inicioStr } = await req.json()

    if (!Array.isArray(meses) || meses.length > 24) {
      return NextResponse.json({ error: 'meses inválido' }, { status: 400 })
    }

    const inicioProjecao = inicioStr
      ? startOfMonth(new Date(inicioStr))
      : startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES))
    const resultados = {
      total: new Array(meses.length).fill(0),
      matheus: new Array(meses.length).fill(0),
      jeniffer: new Array(meses.length).fill(0),
      extra: new Array(meses.length).fill(0),
    }

    const [{ data: maxNubank }, { data: maxCartao1 }, { data: maxCartao2 }] = await Promise.all([
      supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'nubank').order('projeto_fatura', { ascending: false }).limit(1),
      supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'cartao1').order('projeto_fatura', { ascending: false }).limit(1),
      supabase.from('transacoes_nubank').select('projeto_fatura').eq('cartao', 'cartao2').order('projeto_fatura', { ascending: false }).limit(1),
    ])

    const cartoesEFaturas = ([
      ['nubank', maxNubank?.[0]?.projeto_fatura],
      ['cartao1', maxCartao1?.[0]?.projeto_fatura],
      ['cartao2', maxCartao2?.[0]?.projeto_fatura],
    ] as [string, string][]).filter(([, f]) => !!f)

    if (cartoesEFaturas.length === 0) return NextResponse.json(resultados)

    const transacoesResults = await Promise.all(
      cartoesEFaturas.map(([cartao, fatura]) =>
        supabase.from('transacoes_nubank').select('*').eq('cartao', cartao).eq('projeto_fatura', fatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO')
      )
    )
    const transacoesUltimaFatura = transacoesResults.flatMap(r => r.data || [])

    const janelaInicio = format(subMonths(new Date(), JANELA_PARCELAS_MESES), 'yyyy-MM-dd')
    const { data: todasDespesas } = await supabase
      .from('planejamento')
      .select('*')
      .not('item', 'ilike', '[RECEITA]%')
      .gte('mes_referencia', janelaInicio)

    const contratos = buildContracts(transacoesUltimaFatura || [])
    const contratosExtras = buildContratosExtras(todasDespesas || [])

    for (let i = 0; i < meses.length; i++) {
      const mesRef = startOfMonth(addMonths(inicioProjecao, i))

      for (const { row, fatura, parcela } of contratos.values()) {
        const deltaM = (mesRef.getFullYear() - fatura.getFullYear()) * 12 +
          (mesRef.getMonth() - fatura.getMonth())
        const parcelaNoMes = parcela.atual + deltaM

        if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
          resultados.total[i] += row.valor
          if (row.responsavel === 'Matheus') resultados.matheus[i] += row.valor
          else if (row.responsavel === 'Jeniffer') resultados.jeniffer[i] += row.valor
        }
      }

      for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
        const mesesDiff =
          (mesRef.getFullYear() - mesExtra.getFullYear()) * 12 +
          (mesRef.getMonth() - mesExtra.getMonth())
        const restantes = parcela.total - parcela.atual + 1
        if (mesesDiff >= 0 && mesesDiff < restantes) {
          resultados.extra[i] += e.valor_previsto
          resultados.total[i] += e.valor_previsto
        }
      }
    }

    return NextResponse.json(resultados)
  } catch {
    return NextResponse.json({ error: 'Erro na projecao' }, { status: 500 })
  }
}
