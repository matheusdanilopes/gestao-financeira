import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { format, addMonths, startOfMonth, subMonths } from 'date-fns'

const PROJECAO_OFFSET_MESES = 1

function extrairParcelamento(t: any): { atual: number; total: number } | null {
  if (t.parcela_atual && t.total_parcelas) {
    const atual = Number(t.parcela_atual)
    const total = Number(t.total_parcelas)
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const descricao = String(t.descricao || t.item || '')
  const matchParcela = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (matchParcela) {
    const atual = Number(matchParcela[1])
    const total = Number(matchParcela[2])
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const matchSlash = descricao.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (matchSlash) {
    const atual = Number(matchSlash[1])
    const total = Number(matchSlash[2])
    if (atual >= 1 && total >= atual && total >= 2) return { atual, total }
  }
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
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '')
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

function buildContratosExtras(planejamentos: any[]) {
  const map = new Map<string, { row: any; mesRef: Date; parcela: { atual: number; total: number } }>()

  for (const e of planejamentos) {
    const parcela = extrairParcelamento({ ...e, descricao: e.item })
    if (!parcela) continue

    const mesRef = startOfMonth(new Date(e.mes_referencia))
    const origem = subMonths(mesRef, parcela.atual - 1)
    const descBase = String(e.item || '')
      .replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '')
      .trim()
      .toLowerCase()
    const key = `${format(origem, 'yyyy-MM')}|${descBase}|${parcela.total}|${e.responsavel || ''}`

    const existing = map.get(key)
    if (!existing || mesRef > existing.mesRef) {
      map.set(key, { row: e, mesRef, parcela })
    }
  }

  return map
}

function ajustarDescricaoParcelamento(descricao: string, parcelaNoMes: number, total: number): string {
  if (/parcela\s+\d+\/\d+/i.test(descricao)) {
    return descricao.replace(/parcela\s+\d+\/\d+/i, `Parcela ${parcelaNoMes}/${total}`)
  }
  return descricao.replace(/\b\d{1,2}\/\d{1,2}\b/, `${parcelaNoMes}/${total}`)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { serie, dataIndex, mesStr } = await req.json()

    // Prefere mesStr (data exata enviada pelo gráfico); cai no cálculo legado se ausente
    const mesReferencia = mesStr
      ? startOfMonth(new Date(mesStr))
      : startOfMonth(addMonths(startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES)), dataIndex ?? 0))
    let itens: any[] = []

    if (serie === 'Despesas') {
      const { data: todasDespesas } = await supabase
        .from('planejamento')
        .select('item, responsavel, valor_previsto, categoria, parcela_atual, total_parcelas, mes_referencia')
        .not('item', 'ilike', '[RECEITA]%')

      const contratosExtras = buildContratosExtras(todasDespesas || [])
      itens = []

      for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
        const mesesDiff =
          (mesReferencia.getFullYear() - mesExtra.getFullYear()) * 12 +
          (mesReferencia.getMonth() - mesExtra.getMonth())
        const parcelaNoMes = parcela.atual + mesesDiff
        if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
          const descAjustada = ajustarDescricaoParcelamento(String(e.item || ''), parcelaNoMes, parcela.total)
          itens.push({ ...e, descricao: descAjustada, valor: e.valor_previsto, tipo: 'extra', parcela_atual: parcelaNoMes })
        }
      }

    } else {
      // Usa a fatura mais recente do NuBank como base de contratos
      const { data: maxRow } = await supabase
        .from('transacoes_nubank')
        .select('projeto_fatura')
        .eq('cartao', 'nubank')
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
          const descAjustada = ajustarDescricaoParcelamento(String(row.descricao || ''), parcelaNoMes, parcela.total)
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
        const { data: todasDespesas } = await supabase
          .from('planejamento')
          .select('item, responsavel, valor_previsto, categoria, parcela_atual, total_parcelas, mes_referencia')
          .not('item', 'ilike', '[RECEITA]%')

        const contratosExtras = buildContratosExtras(todasDespesas || [])
        const extrasDoMes: any[] = []

        for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
          const mesesDiff =
            (mesReferencia.getFullYear() - mesExtra.getFullYear()) * 12 +
            (mesReferencia.getMonth() - mesExtra.getMonth())
          const parcelaNoMes = parcela.atual + mesesDiff
          if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
            const descAjustada = ajustarDescricaoParcelamento(String(e.item || ''), parcelaNoMes, parcela.total)
            extrasDoMes.push({ ...e, descricao: descAjustada, valor: e.valor_previsto, tipo: 'extra', parcela_atual: parcelaNoMes })
          }
        }

        itens = [...transacoesFiltradas, ...extrasDoMes]
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
