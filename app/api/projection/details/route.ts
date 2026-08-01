import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { addMonths, startOfMonth } from 'date-fns'
import {
  buildContracts,
  buildContratosExtras,
  type TransacaoRowParcelamento as TransacaoRow,
} from '@/lib/parcelamentoProjecao'

const PROJECAO_OFFSET_MESES = 1

function ajustarDescricaoParcelamento(descricao: string, parcelaNoMes: number, total: number): string {
  if (/parcela\s+\d+\/\d+/i.test(descricao)) {
    return descricao.replace(/parcela\s+\d+\/\d+/i, `Parcela ${parcelaNoMes}/${total}`)
  }
  return descricao.replace(/\b\d{1,2}\/\d{1,2}\b/, `${parcelaNoMes}/${total}`)
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, unauthorized } = await requireAuth(req)
    if (unauthorized) return unauthorized
    const { serie, dataIndex, mesStr } = await req.json()

    // Prefere mesStr (data exata enviada pelo gráfico); cai no cálculo legado se ausente
    const mesReferencia = mesStr
      ? startOfMonth(new Date(mesStr))
      : startOfMonth(addMonths(startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES)), dataIndex ?? 0))
    let itens: Record<string, unknown>[] = []

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
      // Busca a última fatura de cada cartão independentemente
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

      let transacoesBase: TransacaoRow[] = []
      if (cartoesEFaturas.length > 0) {
        const filtrarResponsavel = serie === 'Matheus' || serie === 'Jeniffer'
        const resultados = await Promise.all(
          cartoesEFaturas.map(([cartao, fatura]) => {
            let q = supabase.from('transacoes_nubank').select('*').eq('cartao', cartao).eq('projeto_fatura', fatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO')
            if (filtrarResponsavel) q = q.eq('responsavel', serie)
            return q
          })
        )
        transacoesBase = resultados.flatMap(r => r.data || [])
      }

      const contratos = buildContracts(transacoesBase)
      const transacoesFiltradas: Record<string, unknown>[] = []

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
        const extrasDoMes: Record<string, unknown>[] = []

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
