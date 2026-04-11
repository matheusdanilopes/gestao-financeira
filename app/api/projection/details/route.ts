import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { format, addMonths, startOfMonth } from 'date-fns'

export async function POST(req: NextRequest) {
  try {
    const { serie, mes, dataIndex } = await req.json()
    
    const hoje = new Date()
    const mesReferencia = startOfMonth(addMonths(hoje, dataIndex))
    const mesFormatado = format(mesReferencia, 'yyyy-MM-dd')
    
    let itens: any[] = []

    if (serie === 'Extras') {
      // Buscar itens extras do planejamento
      const { data } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria')
        .eq('mes_referencia', mesFormatado)
        .eq('categoria', 'Extra')
      
      itens = data || []
    } 
    else if (serie === 'Matheus' || serie === 'Jeniffer') {
      // Buscar itens fixos do planejamento + transações do cartão
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
        ...(planejamentos || []).map(p => ({ ...p, descricao: p.item, tipo: 'planejamento' })),
        ...(transacoes || []).map(t => ({ ...t, descricao: t.descricao, tipo: 'cartao' }))
      ]
    }
    else if (serie === 'Total') {
      // Buscar todos os itens do mês
      const { data: planejamentos } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria')
        .eq('mes_referencia', mesFormatado)
      
      const { data: transacoes } = await supabase
        .from('transacoes_nubank')
        .select('descricao, responsavel, valor')
        .eq('projeto_fatura', mesFormatado)
      
      itens = [
        ...(planejamentos || []).map(p => ({ ...p, descricao: p.item, valor: p.valor_previsto, tipo: 'planejamento' })),
        ...(transacoes || []).map(t => ({ ...t, descricao: t.descricao, tipo: 'cartao' }))
      ]
    }

    return NextResponse.json({ itens })
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar detalhes' }, { status: 500 })
  }
}