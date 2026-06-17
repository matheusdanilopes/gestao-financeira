import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { format, startOfMonth } from 'date-fns'

type PlanejamentoRow = {
  item: string | null
  valor_previsto: number | null
  pago: boolean | null
  valor_real: number | null
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.unauthorized) return auth.unauthorized

  const mesReferencia = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  const { data, error } = await auth.supabase
    .from('planejamento')
    .select('item, valor_previsto, pago, valor_real')
    .eq('mes_referencia', mesReferencia)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as PlanejamentoRow[]

  let receitaTotal = 0
  let totalDespesas = 0

  for (const row of rows) {
    const item = row.item ?? ''
    const valor = row.valor_previsto ?? 0

    if (item === 'Receita Total' || item.startsWith('[RECEITA]')) {
      receitaTotal += valor
    } else {
      totalDespesas += valor
    }
  }

  const sobraLiquida = receitaTotal - totalDespesas

  return NextResponse.json({ sobraLiquida, receitaTotal, totalDespesas })
}
