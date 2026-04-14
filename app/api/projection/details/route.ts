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

function seriesKey(t: any, parcela: { atual: number; total: number }): string {
  const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
  const origem = subMonths(fatura, parcela.atual - 1)
  return `${format(origem, 'yyyy-MM')}|${t.valor}|${parcela.total}|${t.responsavel}`
}

function estaNoMes(t: any, mesReferencia: Date): boolean {
  const parcela = extrairParcelamento(t)
  if (!parcela) {
    const proj = typeof t.projeto_fatura === 'string'
      ? t.projeto_fatura.substring(0, 10)
      : format(new Date(t.projeto_fatura), 'yyyy-MM-dd')
    return proj === format(mesReferencia, 'yyyy-MM-dd')
  }
  const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data))
  const mesesDiff =
    (mesReferencia.getFullYear() - fatura.getFullYear()) * 12 +
    (mesReferencia.getMonth() - fatura.getMonth())
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

    } else {
      const query = serie === 'Matheus' || serie === 'Jeniffer'
        ? supabase.from('transacoes_nubank').select('*').eq('responsavel', serie)
        : supabase.from('transacoes_nubank').select('*')

      const { data: transacoesTodas } = await query
      const seriesVistas = new Set<string>()
      const transacoesFiltradas: any[] = []

      for (const t of (transacoesTodas || [])) {
        if (!estaNoMes(t, mesReferencia)) continue
        const parcela = extrairParcelamento(t)
        if (parcela) {
          const key = seriesKey(t, parcela)
          if (seriesVistas.has(key)) continue
          seriesVistas.add(key)
        }
        transacoesFiltradas.push({ ...t, tipo: 'cartao' })
      }

      if (serie === 'Total') {
        const { data: planejamentos } = await supabase
          .from('planejamento')
          .select('item, responsavel, valor_previsto, categoria')
          .eq('mes_referencia', mesFormatado)

        itens = [
          ...(planejamentos || []).map(p => ({ ...p, descricao: p.item, valor: p.valor_previsto, tipo: 'planejamento' })),
          ...transacoesFiltradas,
        ]
      } else {
        itens = transacoesFiltradas
      }
    }

    return NextResponse.json({ itens })
  } catch (error) {
    console.error('[details] Erro:', error)
    return NextResponse.json({ error: 'Erro ao buscar detalhes' }, { status: 500 })
  }
}
