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

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)
    const { meses, inicioStr } = await req.json()
    const inicioProjecao = inicioStr
      ? startOfMonth(new Date(inicioStr))
      : startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES))
    const resultados = {
      total: new Array(meses.length).fill(0),
      matheus: new Array(meses.length).fill(0),
      jeniffer: new Array(meses.length).fill(0),
      extra: new Array(meses.length).fill(0),
    }

    // Busca apenas a fatura mais recente disponível no banco
    const { data: maxRow } = await supabase
      .from('transacoes_nubank')
      .select('projeto_fatura')
      .order('projeto_fatura', { ascending: false })
      .limit(1)

    const ultimaFaturaStr = maxRow?.[0]?.projeto_fatura
    if (!ultimaFaturaStr) return NextResponse.json(resultados)

    const { data: transacoesUltimaFatura } = await supabase
      .from('transacoes_nubank')
      .select('*')
      .eq('projeto_fatura', ultimaFaturaStr)

    const { data: todasDespesas } = await supabase
      .from('planejamento')
      .select('*')
      .not('item', 'ilike', '[RECEITA]%')

    // Contratos: apenas parcelamentos da última fatura, deduplicados por série
    const contratos = buildContracts(transacoesUltimaFatura || [])

    // Despesas parceladas do planejamento, deduplicadas por série (mais recente vence)
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
  } catch (error) {
    console.error('[projection] Erro:', error)
    return NextResponse.json({ error: 'Erro na projecao' }, { status: 500 })
  }
}
