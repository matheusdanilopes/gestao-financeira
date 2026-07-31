import { NextRequest, NextResponse } from 'next/server'
import { format, startOfMonth, addMonths, addDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { requireAuth } from '@/lib/serverAuth'
import { calcularDataFechamentoDaFatura } from '@/lib/fatura'

const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Conjunto'] as const
type Responsavel = typeof RESPONSAVEIS[number]

// Mesmo heurístico usado em outras rotas (ex. app/api/notificacoes/resumo-semanal/route.ts)
// para descobrir quem está logado a partir do e-mail — sem tabela de mapeamento dedicada.
function nomeDoUsuario(email: string | undefined): 'Matheus' | 'Jeniffer' {
  const lower = (email ?? '').toLowerCase()
  if (lower.includes('jeniffer') || lower.includes('jennifer')) return 'Jeniffer'
  return 'Matheus'
}

// A fatura do mês é considerada paga quando todos os itens "nubank ..." do
// planejamento daquele mês (com valor previsto) já foram marcados como pagos
// na tela de Despesas (ChecklistMensal.tsx) — mesmo prefixo usado lá.
function faturaEstaPaga(itensPlanejamento: { item: string; valor_previsto: number; pago: boolean }[]): boolean {
  const itensNubank = itensPlanejamento.filter(
    p => String(p.item ?? '').trim().toLowerCase().startsWith('nubank') && Number(p.valor_previsto ?? 0) > 0
  )
  if (itensNubank.length === 0) return false
  return itensNubank.every(p => p.pago === true)
}

interface ParcelamentoPorResponsavel {
  responsavel: Responsavel
  percentual: number | null
  comprometido: number
  limite: number
}

interface FaturaPorResponsavel {
  responsavel: Responsavel
  percentual: number | null
  gasto: number
  previsto: number
}

export interface AlertasFaturaResponse {
  parcelamento: {
    percentual: number | null
    comprometido: number
    limite: number
    falta: number
    porResponsavel: ParcelamentoPorResponsavel[]
  }
  fatura: {
    percentual: number | null
    gasto: number
    previsto: number
    dataFechamento: string
    diasAteFechar: number
    dataVencimento: string
    diasAteVencimento: number
    porResponsavel: FaturaPorResponsavel[]
  }
}

export async function GET(req: NextRequest) {
  const { supabase, unauthorized, user } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const hoje = new Date()

    // Se a fatura do mês corrente já estiver paga, os avisos passam a ser
    // sobre o próximo mês — não faz sentido continuar alertando sobre uma
    // fatura já quitada.
    let mesBase = hoje
    let mesRef = format(startOfMonth(mesBase), 'yyyy-MM-dd')
    let planejamentoMes = (await supabase
      .from('planejamento')
      .select('item, valor_previsto, pago')
      .eq('mes_referencia', mesRef)).data ?? []

    if (faturaEstaPaga(planejamentoMes)) {
      mesBase = addMonths(mesBase, 1)
      mesRef = format(startOfMonth(mesBase), 'yyyy-MM-dd')
      planejamentoMes = (await supabase
        .from('planejamento')
        .select('item, valor_previsto, pago')
        .eq('mes_referencia', mesRef)).data ?? []
    }

    const mesRefFaturaDate = startOfMonth(addMonths(mesBase, 1))
    const mesRefFatura = format(mesRefFaturaDate, 'yyyy-MM-dd')

    const [
      { data: limitesData },
      { data: transacoesFatura },
      { data: planejadosParcelados },
      { data: nubankConfigs },
      { data: faturaRegistradaData },
    ] = await Promise.all([
      supabase
        .from('limites_parcelamentos')
        .select('mes_referencia, responsavel, valor')
        .lte('mes_referencia', mesRef)
        .order('mes_referencia', { ascending: false }),
      supabase
        .from('transacoes_nubank')
        .select('valor, responsavel, total_parcelas')
        .eq('cartao', 'nubank')
        .eq('projeto_fatura', mesRefFatura)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO'),
      supabase
        .from('planejamento')
        .select('valor_previsto, responsavel, total_parcelas')
        .eq('mes_referencia', mesRef)
        .gt('total_parcelas', 1),
      supabase.from('configuracoes').select('chave, valor').in('chave', ['dia_vencimento', 'ajuste_fechamento']),
      supabase.from('faturas').select('data_fechamento').eq('cartao', 'nubank').eq('mes_referencia', mesRefFatura).limit(1),
    ])

    // Ordem de exibição: usuário logado primeiro, depois o outro responsável, "Conjunto" por último.
    const atual = nomeDoUsuario(user?.email)
    const outro: Responsavel = atual === 'Matheus' ? 'Jeniffer' : 'Matheus'
    const ordemExibicao: Responsavel[] = [atual, outro, 'Conjunto']

    // Limite efetivo por responsável: primeiro registro (mais recente) já ordenado desc —
    // herda o valor do mês anterior configurado quando o mês corrente não tem o seu próprio.
    const limiteEfetivo: Record<string, number> = {}
    for (const l of limitesData ?? []) {
      const resp = String(l.responsavel ?? '')
      if (!resp || limiteEfetivo[resp] !== undefined) continue
      limiteEfetivo[resp] = Number(l.valor ?? 0)
    }

    const comprometidoPorResponsavel: Record<string, number> = {}
    for (const t of transacoesFatura ?? []) {
      if (Number(t.total_parcelas ?? 0) <= 1) continue
      const resp = String(t.responsavel ?? '')
      comprometidoPorResponsavel[resp] = (comprometidoPorResponsavel[resp] ?? 0) + Number(t.valor ?? 0)
    }
    for (const p of planejadosParcelados ?? []) {
      const resp = String(p.responsavel ?? '')
      comprometidoPorResponsavel[resp] = (comprometidoPorResponsavel[resp] ?? 0) + Number(p.valor_previsto ?? 0)
    }

    const limite = RESPONSAVEIS.reduce((soma, r) => soma + (limiteEfetivo[r] ?? 0), 0)
    const comprometido = RESPONSAVEIS.reduce((soma, r) => soma + (comprometidoPorResponsavel[r] ?? 0), 0)
    const pctParcelamento = limite > 0 ? (comprometido / limite) * 100 : null
    const falta = limite - comprometido

    const parcelamentoPorResponsavel: ParcelamentoPorResponsavel[] = ordemExibicao.map(responsavel => {
      const limitePessoa = limiteEfetivo[responsavel] ?? 0
      const comprometidoPessoa = comprometidoPorResponsavel[responsavel] ?? 0
      return {
        responsavel,
        percentual: limitePessoa > 0 ? (comprometidoPessoa / limitePessoa) * 100 : null,
        comprometido: comprometidoPessoa,
        limite: limitePessoa,
      }
    })

    const gastoPorResponsavel: Record<string, number> = {}
    for (const t of transacoesFatura ?? []) {
      const resp = String(t.responsavel ?? '')
      gastoPorResponsavel[resp] = (gastoPorResponsavel[resp] ?? 0) + Number(t.valor ?? 0)
    }
    const gasto = RESPONSAVEIS.reduce((soma, r) => soma + (gastoPorResponsavel[r] ?? 0), 0)

    const findPrevisto = (nome: string) =>
      Number((planejamentoMes ?? []).find(p => String(p.item ?? '').trim().toLowerCase() === nome)?.valor_previsto ?? 0)
    const previstoPorResponsavel: Record<Responsavel, number> = {
      Matheus: findPrevisto('nubank matheus'),
      Jeniffer: findPrevisto('nubank jeniffer') + findPrevisto('nubank jeniffer conjunto'),
      Conjunto: findPrevisto('nubank conjunto'),
    }
    const previsto = RESPONSAVEIS.reduce((soma, r) => soma + previstoPorResponsavel[r], 0)

    const pctGasto = previsto > 0 ? (gasto / previsto) * 100 : null

    const faturaPorResponsavel: FaturaPorResponsavel[] = ordemExibicao.map(responsavel => {
      const previstoPessoa = previstoPorResponsavel[responsavel]
      const gastoPessoa = gastoPorResponsavel[responsavel] ?? 0
      return {
        responsavel,
        percentual: previstoPessoa > 0 ? (gastoPessoa / previstoPessoa) * 100 : null,
        gasto: gastoPessoa,
        previsto: previstoPessoa,
      }
    })

    const diaVencimento = parseInt(nubankConfigs?.find(c => c.chave === 'dia_vencimento')?.valor || '10')
    const ajusteFechamento = parseInt(nubankConfigs?.find(c => c.chave === 'ajuste_fechamento')?.valor || '0')
    const dataFechamento =
      faturaRegistradaData?.[0]?.data_fechamento ||
      format(calcularDataFechamentoDaFatura(mesRefFaturaDate, diaVencimento, ajusteFechamento), 'yyyy-MM-dd')
    const dataFechamentoDate = parseISO(dataFechamento)
    const diasAteFechar = differenceInCalendarDays(dataFechamentoDate, hoje)
    const dataVencimentoDate = addDays(dataFechamentoDate, 7)
    const dataVencimento = format(dataVencimentoDate, 'yyyy-MM-dd')
    const diasAteVencimento = differenceInCalendarDays(dataVencimentoDate, hoje)

    const response: AlertasFaturaResponse = {
      parcelamento: { percentual: pctParcelamento, comprometido, limite, falta, porResponsavel: parcelamentoPorResponsavel },
      fatura: {
        percentual: pctGasto,
        gasto,
        previsto,
        dataFechamento,
        diasAteFechar,
        dataVencimento,
        diasAteVencimento,
        porResponsavel: faturaPorResponsavel,
      },
    }

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Falha ao calcular alertas da fatura', details: msg }, { status: 500 })
  }
}
