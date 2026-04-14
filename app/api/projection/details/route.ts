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
      // Usa apenas a fatura mais recente como base de contratos
      const { data: maxRow } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura')
        .order('projeto_fatura', { ascending: false })
        .limit(1)

      const ultimaFaturaStr = maxRow?.[0]?.projeto_fatura
      let transacoesBase: any[] = []
      if (ultimaFaturaStr) {
        const query = serie === 'Matheus' || serie === 'Jeniffer'
          ? supabase.from('transacoes_nubank').select('*').eq('projeto_fatura', ultimaFaturaStr).eq('responsavel', serie)
          : supabase.from('transacoes_nubank').select('*').eq('projeto_fatura', ultimaFaturaStr)
        const { data } = await query
        transacoesBase = data || []
      }

      const contratos = buildContracts(transacoesBase)
      const transacoesFiltradas: any[] = []

      for (const { row, fatura, parcela } of contratos.values()) {
        const deltaM =
          (mesReferencia.getFullYear() - fatura.getFullYear()) * 12 +
          (mesReferencia.getMonth() - fatura.getMonth())
        const parcelaNoMes = parcela.atual + deltaM

        if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
          // Exibe o número correto da parcela para este mês projetado
          const descAjustada = String(row.descricao || '')
            .replace(/parcela\s+\d+\/\d+/i, `Parcela ${parcelaNoMes}/${parcela.total}`)
          const { ...rowClean } = row
          transacoesFiltradas.push({
            ...rowClean,
            descricao: descAjustada,
            parcela_atual: parcelaNoMes,
            tipo: 'cartao',
          })
        }
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
