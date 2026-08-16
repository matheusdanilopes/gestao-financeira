import { NextRequest, NextResponse } from 'next/server'
import { format, startOfMonth, addMonths, addDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { requireAuth } from '@/lib/serverAuth'
import { calcularDataFechamentoDaFatura } from '@/lib/fatura'
import { tipoCartaoPorItem } from '@/lib/tipoCartao'

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
    p => tipoCartaoPorItem(p.item) === 'principal' && Number(p.valor_previsto ?? 0) > 0
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
    // Exclui itens vinculados a outro cartão (prefixo [CARTAO1]/[CARTAO2], mesma
    // convenção de app/api/import/cartao/route.ts) — o previsto e o check de fatura
    // paga aqui são específicos do Nubank.
    const buscarPlanejamentoNubank = async (mes: string) =>
      (await supabase
        .from('planejamento')
        .select('item, valor_previsto, pago, responsavel')
        .eq('mes_referencia', mes)
        .not('item', 'ilike', '[CARTAO1]%')
        .not('item', 'ilike', '[CARTAO2]%')).data ?? []

    let mesBase = hoje
    let mesRef = format(startOfMonth(mesBase), 'yyyy-MM-dd')
    let planejamentoMes = await buscarPlanejamentoNubank(mesRef)

    if (faturaEstaPaga(planejamentoMes)) {
      mesBase = addMonths(mesBase, 1)
      mesRef = format(startOfMonth(mesBase), 'yyyy-MM-dd')
      planejamentoMes = await buscarPlanejamentoNubank(mesRef)
    }

    const mesRefFaturaDate = startOfMonth(addMonths(mesBase, 1))
    const mesRefFatura = format(mesRefFaturaDate, 'yyyy-MM-dd')

    const [
      { data: limitesData },
      { data: transacoesFatura },
      { data: planejadosParcelados },
      { data: transacoesOutrosCartoes },
      { data: planejadosOutrosCartoes },
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
      // Este popup é específico da fatura Nubank — exclui itens de planejamento
      // parcelado vinculados a outro cartão (mesmo prefixo [CARTAO1]/[CARTAO2]
      // usado em app/api/import/cartao/route.ts).
      supabase
        .from('planejamento')
        .select('valor_previsto, responsavel, total_parcelas')
        .eq('mes_referencia', mesRef)
        .gt('total_parcelas', 1)
        .not('item', 'ilike', '[CARTAO1]%')
        .not('item', 'ilike', '[CARTAO2]%'),
      // Parcelas já comprometidas em OUTROS cartões (ex. PicPay Matheus, Cartão 2
      // Jeniffer) do responsável — descontadas do limite geral, já que ele é
      // compartilhado entre todos os cartões, não só o Nubank.
      supabase
        .from('transacoes_nubank')
        .select('valor, responsavel, total_parcelas')
        .neq('cartao', 'nubank')
        .eq('projeto_fatura', mesRefFatura)
        .gt('total_parcelas', 1)
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO'),
      supabase
        .from('planejamento')
        .select('valor_previsto, responsavel')
        .eq('mes_referencia', mesRef)
        .gt('total_parcelas', 1)
        .or('item.ilike.[CARTAO1]%,item.ilike.[CARTAO2]%'),
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

    // Parcelas já comprometidas em outros cartões (PicPay, Cartão 2 etc.) do mesmo
    // responsável — descontadas do limite geral antes de medir o uso pelo Nubank,
    // já que o limite não é exclusivo do Nubank.
    const outrosCartoesPorResponsavel: Record<string, number> = {}
    for (const t of transacoesOutrosCartoes ?? []) {
      const resp = String(t.responsavel ?? '')
      outrosCartoesPorResponsavel[resp] = (outrosCartoesPorResponsavel[resp] ?? 0) + Number(t.valor ?? 0)
    }
    for (const p of planejadosOutrosCartoes ?? []) {
      const resp = String(p.responsavel ?? '')
      outrosCartoesPorResponsavel[resp] = (outrosCartoesPorResponsavel[resp] ?? 0) + Number(p.valor_previsto ?? 0)
    }

    // Limite ainda disponível para o Nubank = limite geral menos o que os outros
    // cartões do responsável já consumiram. Pode ficar negativo se os outros
    // cartões, sozinhos, já ultrapassarem o limite.
    const limiteDisponivelPorResponsavel: Record<string, number> = {}
    for (const r of RESPONSAVEIS) {
      limiteDisponivelPorResponsavel[r] = (limiteEfetivo[r] ?? 0) - (outrosCartoesPorResponsavel[r] ?? 0)
    }

    function calcularPercentual(comprometidoNubank: number, limiteBruto: number, limiteDisponivel: number): number | null {
      if (limiteBruto <= 0) return null
      if (limiteDisponivel <= 0) return comprometidoNubank > 0 ? 100 + (comprometidoNubank / limiteBruto) * 100 : 100
      return (comprometidoNubank / limiteDisponivel) * 100
    }

    const limite = RESPONSAVEIS.reduce((soma, r) => soma + limiteDisponivelPorResponsavel[r], 0)
    const limiteBrutoTotal = RESPONSAVEIS.reduce((soma, r) => soma + (limiteEfetivo[r] ?? 0), 0)
    const comprometido = RESPONSAVEIS.reduce((soma, r) => soma + (comprometidoPorResponsavel[r] ?? 0), 0)
    const pctParcelamento = calcularPercentual(comprometido, limiteBrutoTotal, limite)
    const falta = limite - comprometido

    const parcelamentoPorResponsavel: ParcelamentoPorResponsavel[] = ordemExibicao.map(responsavel => {
      const limitePessoa = limiteDisponivelPorResponsavel[responsavel] ?? 0
      const limiteBrutoPessoa = limiteEfetivo[responsavel] ?? 0
      const comprometidoPessoa = comprometidoPorResponsavel[responsavel] ?? 0
      return {
        responsavel,
        percentual: calcularPercentual(comprometidoPessoa, limiteBrutoPessoa, limitePessoa),
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

    // Previsto do cartão principal por responsável. Antes vinha de quatro nomes
    // literais ("nubank jeniffer conjunto" etc.); agora sai da coluna responsavel.
    const previstoPrincipalDe = (responsavel: string) =>
      (planejamentoMes ?? [])
        .filter(p => tipoCartaoPorItem(p.item) === 'principal' && p.responsavel === responsavel)
        .reduce((soma, p) => soma + Number(p.valor_previsto ?? 0), 0)
    const previstoPorResponsavel: Record<Responsavel, number> = {
      Matheus: previstoPrincipalDe('Matheus'),
      Jeniffer: previstoPrincipalDe('Jeniffer'),
      Conjunto: previstoPrincipalDe('Conjunto'),
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
