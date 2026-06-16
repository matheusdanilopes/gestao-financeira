import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { format, addMonths, startOfMonth, subMonths } from 'date-fns'

const JANELA_PARCELAS_MESES = 36
const PROJECAO_OFFSET_MESES = 1

type TransacaoRow = {
  descricao?: string | null
  item?: string | null
  parcela_atual?: number | string | null
  total_parcelas?: number | string | null
  projeto_fatura?: string | null
  data_compra?: string | null
  data?: string | null
  cartao?: string | null
  responsavel?: string | null
  valor?: number | null
  [key: string]: unknown
}

type PlanejamentoRow = {
  item?: string | null
  responsavel?: string | null
  valor_previsto?: number | null
  parcela_atual?: number | string | null
  total_parcelas?: number | string | null
  mes_referencia?: string | null
  [key: string]: unknown
}

function extrairParcelamento(t: TransacaoRow | PlanejamentoRow): { atual: number; total: number } | null {
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

function buildContracts(transacoes: TransacaoRow[]) {
  const map = new Map<string, { row: TransacaoRow; fatura: Date; parcela: { atual: number; total: number } }>()

  for (const t of transacoes) {
    const parcela = extrairParcelamento(t)
    if (!parcela) continue

    const fatura = startOfMonth(new Date(t.projeto_fatura || t.data_compra || t.data || ''))
    const origem = subMonths(fatura, parcela.atual - 1)
    const descBase = String(t.descricao || '')
      .replace(/\s*[-–]\s*parcela\s+\d+\/\d+.*/i, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/i, '')
      .trim()
      .toLowerCase()
    const cartao = t.cartao || 'nubank'
    const key = `${cartao}|${format(origem, 'yyyy-MM')}|${descBase}|${parcela.total}|${t.responsavel}`

    const existing = map.get(key)
    if (!existing || fatura > existing.fatura) {
      map.set(key, { row: t, fatura, parcela })
    }
  }

  return map
}

function buildContratosExtras(planejamentos: PlanejamentoRow[]) {
  const map = new Map<string, { row: PlanejamentoRow; mesRef: Date; parcela: { atual: number; total: number } }>()

  for (const e of planejamentos) {
    const parcela = extrairParcelamento({ ...e, descricao: e.item })
    if (!parcela) continue

    const mesRef = startOfMonth(new Date(e.mes_referencia || ''))
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
