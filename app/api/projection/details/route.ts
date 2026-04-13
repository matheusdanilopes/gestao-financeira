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

function estaNoMesProjetado(t: any, mesReferencia: Date): boolean {
  const parcela = extrairParcelamento(t)
  if (!parcela) {
    const projeto = typeof t.projeto_fatura === 'string'
      ? t.projeto_fatura.substring(0, 10)
      : format(new Date(t.projeto_fatura), 'yyyy-MM-dd')
    return projeto === format(mesReferencia, 'yyyy-MM-dd')
  }
  const base = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
  const mesesDiff =
    (mesReferencia.getFullYear() - base.getFullYear()) * 12 +
    (mesReferencia.getMonth() - base.getMonth())
  const restantes = parcela.total - parcela.atual + 1
  return mesesDiff >= 0 && mesesDiff < restantes
}

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { serie, dataIndex } = await req.json()

    const inicioProjecao = startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES))
    const mesReferencia = startOfMonth(addMonths(inicioProjecao, dataIndex))
    const mesFormatado = format(mesReferencia, 'yyyy-MM-dd')

    let itens: any[] = []

    if (serie === 'Extra') {
      const { data: todosExtras } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria, parcela_atual, total_parcelas, mes_referencia')
        .eq('categoria', 'Extra')

      itens = (todosExtras || [])
        .filter(e => {
          if (e.parcela_atual && e.total_parcelas) {
            const mesExtra = startOfMonth(new Date(e.mes_referencia))
            const mesesDiff =
              (mesReferencia.getFullYear() - mesExtra.getFullYear()) * 12 +
              (mesReferencia.getMonth() - mesExtra.getMonth())
            return mesesDiff >= 0 && mesesDiff < (e.total_parcelas - e.parcela_atual + 1)
          }
          return e.mes_referencia === mesFormatado
        })
        .map(e => ({ ...e, descricao: e.item, valor: e.valor_previsto, tipo: 'extra' }))

    } else if (serie === 'Matheus' || serie === 'Jeniffer') {
      const { data: transacoesTodas } = await supabase
        .from('transacoes_nubank')
        .select('*')
        .eq('responsavel', serie)

      const transacoes = deduplicarParcelamentos(transacoesTodas || [])
        .filter(t => estaNoMesProjetado(t, mesReferencia))

      itens = transacoes.map(t => ({ ...t, tipo: 'cartao' }))

    } else if (serie === 'Total') {
      const { data: transacoesTodas } = await supabase.from('transacoes_nubank').select('*')
      const transacoes = deduplicarParcelamentos(transacoesTodas || [])
        .filter(t => estaNoMesProjetado(t, mesReferencia))

      const { data: planejamentos } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria')
        .eq('mes_referencia', mesFormatado)

      itens = [
        ...(planejamentos || []).map(p => ({ ...p, descricao: p.item, valor: p.valor_previsto, tipo: 'planejamento' })),
        ...transacoes.map(t => ({ ...t, tipo: 'cartao' })),
      ]
    }

    return NextResponse.json({ itens })
  } catch (error) {
    console.error('[details] Erro:', error)
    return NextResponse.json({ error: 'Erro ao buscar detalhes' }, { status: 500 })
  }
}
