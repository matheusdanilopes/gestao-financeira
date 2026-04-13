import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth } from 'date-fns'

function extrairParcelamento(t: any) {
  if (t.parcela_atual && t.total_parcelas) {
    return { atual: Number(t.parcela_atual), total: Number(t.total_parcelas) }
  }

  const descricao = String(t.descricao || '')
  const match = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i) || descricao.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null

  return { atual: Number(match[1]), total: Number(match[2]) }
}

function estaNoMesProjetado(t: any, mesReferencia: Date) {
  const parcela = extrairParcelamento(t)
  if (!parcela) {
    const projeto = typeof t.projeto_fatura === 'string' ? t.projeto_fatura.substring(0, 10) : format(new Date(t.projeto_fatura), 'yyyy-MM-dd')
    return projeto === format(mesReferencia, 'yyyy-MM-dd')
  }

  const base = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
  const mesesDiff =
    (mesReferencia.getMonth() - base.getMonth()) +
    (mesReferencia.getFullYear() - base.getFullYear()) * 12
  const restantes = parcela.total - parcela.atual + 1
  return mesesDiff >= 0 && mesesDiff < restantes
}

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { serie, dataIndex } = await req.json()

    const hoje = new Date()
    const mesReferencia = startOfMonth(addMonths(hoje, dataIndex + 1))
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

      const { data: transacoesTodas } = await supabase
        .from('transacoes_nubank')
        .select('*')
        .eq('responsavel', responsavel)

      const transacoes = (transacoesTodas || []).filter((t: any) => estaNoMesProjetado(t, mesReferencia))

      itens = [
        ...(planejamentos || []).map(function(p) { return { ...p, descricao: p.item, tipo: 'planejamento' } }),
        ...transacoes.map(function(t: any) { return { ...t, tipo: 'cartao' } }),
      ]
    } else if (serie === 'Total') {
      const { data: planejamentos } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria')
        .eq('mes_referencia', mesFormatado)

      const { data: transacoesTodas } = await supabase
        .from('transacoes_nubank')
        .select('*')

      const transacoes = (transacoesTodas || []).filter((t: any) => estaNoMesProjetado(t, mesReferencia))

      itens = [
        ...(planejamentos || []).map(function(p) { return { ...p, descricao: p.item, valor: p.valor_previsto, tipo: 'planejamento' } }),
        ...transacoes.map(function(t: any) { return { ...t, tipo: 'cartao' } }),
      ]
    }

    return NextResponse.json({ itens })
  } catch (error) {
    console.error('[details] Erro:', error)
    return NextResponse.json({ error: 'Erro ao buscar detalhes' }, { status: 500 })
  }
}
