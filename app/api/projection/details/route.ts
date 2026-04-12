import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth } from 'date-fns'

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { serie, mes, dataIndex } = await req.json()

    const hoje = new Date()
    const mesReferencia = startOfMonth(addMonths(hoje, dataIndex))
    const mesFormatado = format(mesReferencia, 'yyyy-MM-dd')

    let itens: any[] = []

    if (serie === 'Extra') {
      const { data: todosExtras } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria, parcela_atual, total_parcelas, mes_referencia')
        .eq('categoria', 'Extra')

      const extras = (todosExtras || []).filter(function(e) {
        if (e.parcela_atual && e.total_parcelas) {
          const mesExtra = startOfMonth(new Date(e.mes_referencia))
          const mesesDiff =
            (mesReferencia.getMonth() - mesExtra.getMonth()) +
            (mesReferencia.getFullYear() - mesExtra.getFullYear()) * 12
          const parcelasRestantes = e.total_parcelas - e.parcela_atual + 1
          return mesesDiff >= 0 && mesesDiff < parcelasRestantes
        }
        return e.mes_referencia === mesFormatado
      })

      itens = extras.map(function(e) {
        return { ...e, descricao: e.item, valor: e.valor_previsto, tipo: 'extra' }
      })
    } else if (serie === 'Matheus' || serie === 'Jeniffer') {
      const responsavel = serie

      const { data: planejamentos } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria')
        .eq('mes_referencia', mesFormatado)
        .eq('categoria', 'Fixa')
        .eq('responsavel', responsavel)

      const { data: transacoes } = await supabase
        .from('transacoes_nubank')
        .select('descricao, responsavel, valor')
        .eq('projeto_fatura', mesFormatado)
        .eq('responsavel', responsavel)

      itens = [
        ...(planejamentos || []).map(function(p) { return { ...p, descricao: p.item, tipo: 'planejamento' } }),
        ...(transacoes || []).map(function(t) { return { ...t, tipo: 'cartao' } }),
      ]
    } else if (serie === 'Total') {
      const { data: planejamentos } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria')
        .eq('mes_referencia', mesFormatado)

      const { data: transacoes } = await supabase
        .from('transacoes_nubank')
        .select('descricao, responsavel, valor')
        .eq('projeto_fatura', mesFormatado)

      itens = [
        ...(planejamentos || []).map(function(p) { return { ...p, descricao: p.item, valor: p.valor_previsto, tipo: 'planejamento' } }),
        ...(transacoes || []).map(function(t) { return { ...t, tipo: 'cartao' } }),
      ]
    }

    return NextResponse.json({ itens })
  } catch (error) {
    console.error('[details] Erro:', error)
    return NextResponse.json({ error: 'Erro ao buscar detalhes' }, { status: 500 })
  }
}
