// Pré-calcula métricas de parcelamentos (limite, tendência, concentração de risco,
// meses futuros em risco, "quando fica livre") a partir do mesmo motor de
// reconstrução de contratos usado em app/api/projection/route.ts — evita dump de
// dados brutos para a IA, mesmo padrão de lib/ai/insightsEngine.ts.

import { format, startOfMonth, addMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { criarSupabaseServer } from '@/lib/supabaseServer'
import {
  buildContracts,
  buildContratosExtras,
  type TransacaoRowParcelamento,
  type PlanejamentoRowParcelamento,
} from '@/lib/parcelamentoProjecao'
import { resolverLimiteEfetivo, type LimiteParcelamentoRow } from '@/lib/limitesParcelamentos'
import { RESPONSAVEIS, type Responsavel } from '@/lib/responsavelStyle'
import type { InsightItem } from '@/lib/insightsTypes'

type SupabaseServerClient = ReturnType<typeof criarSupabaseServer>

const HORIZONTE_FUTURO_MESES = 6
const HORIZONTE_HISTORICO_MESES = 6
const JANELA_PLANEJAMENTO_MESES = 36

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function mesLabel(d: Date): string {
  return capitalizar(format(d, 'MMM/yyyy', { locale: ptBR }))
}

function novoBucket(): Record<Responsavel, number> {
  return { Matheus: 0, Jeniffer: 0, Conjunto: 0 }
}

function somarResponsavel(bucket: Record<Responsavel, number>, responsavel: string | null | undefined, valor: number) {
  const r = responsavel as Responsavel
  if (RESPONSAVEIS.includes(r)) bucket[r] += valor
}

export interface CategoriaParcelamento {
  categoria: string
  valor: number
  percentual: number
}

export interface MesRisco {
  mes: string
  responsavel: Responsavel
  comprometido: number
  limite: number
}

export interface ParcelamentosMetrics {
  mesAtualLabel: string
  comprometidoPorPessoa: Record<Responsavel, number>
  limitePorPessoa: Record<Responsavel, number | null>
  pctPorPessoa: Record<Responsavel, number | null>
  totalComprometido: number
  totalLimite: number
  concentracao: { responsavel: Responsavel; percentual: number } | null
  tendenciaPct: number | null
  mediaHistorica6m: number
  novasParcelasMes: number
  topCategorias: CategoriaParcelamento[]
  livreEmPorPessoa: Record<'Matheus' | 'Jeniffer', string | null>
  livreEmCasal: string | null
  mesesComRisco: MesRisco[]
}

/**
 * Busca a fatura mais recente de cada cartão + a janela de planejamento e
 * reconstrói os contratos de parcelamento (mesmo padrão de app/api/projection).
 */
async function buscarContratos(supabase: SupabaseServerClient) {
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

  let transacoesUltimaFatura: TransacaoRowParcelamento[] = []
  if (cartoesEFaturas.length > 0) {
    const resultados = await Promise.all(
      cartoesEFaturas.map(([cartao, fatura]) =>
        supabase.from('transacoes_nubank').select('*').eq('cartao', cartao).eq('projeto_fatura', fatura).neq('status', 'ESTORNO').neq('status', 'ESTORNADO')
      )
    )
    transacoesUltimaFatura = resultados.flatMap(r => (r.data ?? []) as TransacaoRowParcelamento[])
  }

  const janelaInicio = format(addMonths(startOfMonth(new Date()), -JANELA_PLANEJAMENTO_MESES), 'yyyy-MM-dd')
  const { data: todasDespesas } = await supabase
    .from('planejamento')
    .select('*')
    .not('item', 'ilike', '[RECEITA]%')
    .gte('mes_referencia', janelaInicio)

  return {
    contratos: buildContracts(transacoesUltimaFatura),
    contratosExtras: buildContratosExtras((todasDespesas ?? []) as PlanejamentoRowParcelamento[]),
  }
}

export async function computeParcelamentosMetrics(supabase: SupabaseServerClient): Promise<ParcelamentosMetrics> {
  const [{ contratos, contratosExtras }, { data: limitesData }] = await Promise.all([
    buscarContratos(supabase),
    supabase.from('limites_parcelamentos').select('mes_referencia, responsavel, valor'),
  ])
  const limites = (limitesData ?? []) as LimiteParcelamentoRow[]

  const hoje = new Date()
  // Mesmo par calendário/fatura usado em ParcelamentosMensal.tsx: o limite é
  // configurado no mês calendário, mas o comprometido é medido na fatura do
  // mês seguinte (quando a compra parcelada de fato aparece na fatura).
  const mesReferenciaAtual = startOfMonth(hoje)
  const mesFaturaAtual = startOfMonth(addMonths(hoje, 1))

  const totaisPorDelta: Record<number, Record<Responsavel, number>> = {}
  const categoriasAtual: Record<string, number> = {}
  let novasParcelasMes = 0

  for (let i = -HORIZONTE_HISTORICO_MESES; i <= HORIZONTE_FUTURO_MESES; i++) {
    const faturaMes = addMonths(mesFaturaAtual, i)
    const bucket = novoBucket()

    for (const { row, fatura, parcela } of contratos.values()) {
      const deltaM = (faturaMes.getFullYear() - fatura.getFullYear()) * 12 + (faturaMes.getMonth() - fatura.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes < 1 || parcelaNoMes > parcela.total) continue
      const valor = Number(row.valor ?? 0)
      somarResponsavel(bucket, row.responsavel as string, valor)
      if (i === 0) {
        if (parcelaNoMes === 1) novasParcelasMes++
        const cat = String(row.categoria ?? 'Sem categoria')
        categoriasAtual[cat] = (categoriasAtual[cat] ?? 0) + valor
      }
    }

    for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
      const deltaM = (faturaMes.getFullYear() - mesExtra.getFullYear()) * 12 + (faturaMes.getMonth() - mesExtra.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes < 1 || parcelaNoMes > parcela.total) continue
      const valor = Number(e.valor_previsto ?? 0)
      somarResponsavel(bucket, e.responsavel as string, valor)
      if (i === 0) {
        if (parcelaNoMes === 1) novasParcelasMes++
        const cat = String(e.categoria ?? 'Sem categoria')
        categoriasAtual[cat] = (categoriasAtual[cat] ?? 0) + valor
      }
    }

    totaisPorDelta[i] = bucket
  }

  const comprometidoPorPessoa = totaisPorDelta[0]
  const totalComprometido = RESPONSAVEIS.reduce((s, r) => s + comprometidoPorPessoa[r], 0)

  const limitePorPessoa: Record<Responsavel, number | null> = { Matheus: null, Jeniffer: null, Conjunto: null }
  const pctPorPessoa: Record<Responsavel, number | null> = { Matheus: null, Jeniffer: null, Conjunto: null }
  for (const r of RESPONSAVEIS) {
    const efetivo = resolverLimiteEfetivo(limites, format(mesReferenciaAtual, 'yyyy-MM-dd'), r)
    limitePorPessoa[r] = efetivo?.valor ?? null
    pctPorPessoa[r] = efetivo && efetivo.valor > 0 ? (comprometidoPorPessoa[r] / efetivo.valor) * 100 : null
  }
  const totalLimite = RESPONSAVEIS.reduce((s, r) => s + (limitePorPessoa[r] ?? 0), 0)

  const totalMJAtual = comprometidoPorPessoa.Matheus + comprometidoPorPessoa.Jeniffer
  const concentracao = totalMJAtual > 0
    ? (() => {
        const maior: Responsavel = comprometidoPorPessoa.Matheus >= comprometidoPorPessoa.Jeniffer ? 'Matheus' : 'Jeniffer'
        return { responsavel: maior, percentual: (comprometidoPorPessoa[maior] / totalMJAtual) * 100 }
      })()
    : null

  let somaHistorico = 0
  for (let i = -HORIZONTE_HISTORICO_MESES; i <= -1; i++) {
    somaHistorico += RESPONSAVEIS.reduce((s, r) => s + totaisPorDelta[i][r], 0)
  }
  const mediaHistorica6m = somaHistorico / HORIZONTE_HISTORICO_MESES
  const tendenciaPct = mediaHistorica6m > 0 ? ((totalComprometido - mediaHistorica6m) / mediaHistorica6m) * 100 : null

  const topCategorias: CategoriaParcelamento[] = Object.entries(categoriasAtual)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([categoria, valor]) => ({ categoria, valor, percentual: totalComprometido > 0 ? (valor / totalComprometido) * 100 : 0 }))

  const mesesComRisco: MesRisco[] = []
  for (let i = 1; i <= HORIZONTE_FUTURO_MESES; i++) {
    const calendarMes = addMonths(mesReferenciaAtual, i)
    const faturaMes = addMonths(mesFaturaAtual, i)
    for (const r of RESPONSAVEIS) {
      const efetivo = resolverLimiteEfetivo(limites, format(calendarMes, 'yyyy-MM-dd'), r)
      if (!efetivo || efetivo.valor <= 0) continue
      const comprometido = totaisPorDelta[i][r]
      if (comprometido > efetivo.valor) {
        mesesComRisco.push({ mes: mesLabel(faturaMes), responsavel: r, comprometido, limite: efetivo.valor })
      }
    }
  }

  // "Quando fica livre": maior mês de término entre os contratos ainda abertos.
  const livreEmPorPessoa: Record<'Matheus' | 'Jeniffer', Date | null> = { Matheus: null, Jeniffer: null }
  let livreEmCasal: Date | null = null

  const registrarTermino = (responsavel: string | null | undefined, mesTermino: Date) => {
    if (mesTermino < mesFaturaAtual) return // parcela já encerrada
    if (!livreEmCasal || mesTermino > livreEmCasal) livreEmCasal = mesTermino
    if (responsavel === 'Matheus' || responsavel === 'Jeniffer') {
      const atual = livreEmPorPessoa[responsavel]
      if (!atual || mesTermino > atual) livreEmPorPessoa[responsavel] = mesTermino
    }
  }

  for (const { row, fatura, parcela } of contratos.values()) {
    registrarTermino(row.responsavel as string, addMonths(fatura, parcela.total - parcela.atual))
  }
  for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
    registrarTermino(e.responsavel as string, addMonths(mesExtra, parcela.total - parcela.atual))
  }

  return {
    mesAtualLabel: mesLabel(mesFaturaAtual),
    comprometidoPorPessoa,
    limitePorPessoa,
    pctPorPessoa,
    totalComprometido,
    totalLimite,
    concentracao,
    tendenciaPct,
    mediaHistorica6m,
    novasParcelasMes,
    topCategorias,
    livreEmPorPessoa: {
      Matheus: livreEmPorPessoa.Matheus ? mesLabel(livreEmPorPessoa.Matheus) : null,
      Jeniffer: livreEmPorPessoa.Jeniffer ? mesLabel(livreEmPorPessoa.Jeniffer) : null,
    },
    livreEmCasal: livreEmCasal ? mesLabel(livreEmCasal) : null,
    mesesComRisco: mesesComRisco.slice(0, 4),
  }
}

const fmtR2 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const signPct2 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

export function serializeParcelamentosCompact(m: ParcelamentosMetrics): string {
  const r2 = (n: number) => Math.round(n * 100) / 100
  return JSON.stringify({
    mes: m.mesAtualLabel,
    comprometido: { M: r2(m.comprometidoPorPessoa.Matheus), J: r2(m.comprometidoPorPessoa.Jeniffer), C: r2(m.comprometidoPorPessoa.Conjunto), total: r2(m.totalComprometido) },
    limite: { M: m.limitePorPessoa.Matheus, J: m.limitePorPessoa.Jeniffer, C: m.limitePorPessoa.Conjunto, total: r2(m.totalLimite) || undefined },
    pct: { M: m.pctPorPessoa.Matheus !== null ? r2(m.pctPorPessoa.Matheus) : undefined, J: m.pctPorPessoa.Jeniffer !== null ? r2(m.pctPorPessoa.Jeniffer) : undefined },
    concentracao: m.concentracao ? { quem: m.concentracao.responsavel, pct: r2(m.concentracao.percentual) } : undefined,
    tendenciaPct: m.tendenciaPct !== null ? r2(m.tendenciaPct) : undefined,
    mediaHistorica6m: r2(m.mediaHistorica6m),
    novasParcelasMes: m.novasParcelasMes,
    topCategorias: m.topCategorias.map(c => [c.categoria, r2(c.valor), Math.round(c.percentual)]),
    livreEm: { M: m.livreEmPorPessoa.Matheus, J: m.livreEmPorPessoa.Jeniffer, casal: m.livreEmCasal },
    mesesComRisco: m.mesesComRisco.map(r => [r.mes, r.responsavel, r2(r.comprometido), r2(r.limite)]),
  })
}

export function generateFallbackParcelamentosInsights(m: ParcelamentosMetrics): InsightItem[] {
  const items: InsightItem[] = []

  // 1 — Limite do mês atual
  if (m.totalLimite > 0) {
    const pct = (m.totalComprometido / m.totalLimite) * 100
    const estourado = pct >= 100
    const perto = pct >= 80 && pct < 100
    items.push({
      icone: estourado ? '🚨' : perto ? '⚠️' : '✅',
      titulo: estourado
        ? `Limite de parcelamentos estourado`
        : perto
        ? `Perto do limite de parcelamentos`
        : `Parcelamentos dentro do limite`,
      detalhe: `${fmtR2(m.totalComprometido)} comprometido de ${fmtR2(m.totalLimite)} (${Math.round(pct)}%)`,
      recomendacao: estourado
        ? `Evite abrir novas parcelas este mês — considere pagar algo à vista`
        : perto
        ? `Avalie se vale a pena mais uma parcela antes de comprometer o restante`
        : `Ainda há margem — use o simulador antes de parcelar algo novo`,
      nivel: estourado ? 'alerta' : perto ? 'sugestao' : 'positivo',
    })
  } else {
    items.push({
      icone: '🎯',
      titulo: `Nenhum limite de parcelamentos configurado`,
      detalhe: `${fmtR2(m.totalComprometido)} comprometido este mês, sem teto definido`,
      recomendacao: `Configure um limite mensal para acompanhar o quanto ainda pode comprometer`,
      nivel: 'sugestao',
    })
  }

  // 2 — Concentração de risco entre Matheus/Jeniffer
  if (m.concentracao && m.concentracao.percentual > 65) {
    items.push({
      icone: '⚖️',
      titulo: `Parcelamentos concentrados em ${m.concentracao.responsavel}`,
      detalhe: `${m.concentracao.responsavel} responde por ${Math.round(m.concentracao.percentual)}% do comprometido do casal`,
      recomendacao: `Avalie equilibrar novas compras parceladas com a outra pessoa`,
      nivel: 'sugestao',
    })
  } else if (m.tendenciaPct !== null) {
    const alta = m.tendenciaPct > 15
    const baixa = m.tendenciaPct < -15
    items.push({
      icone: alta ? '📈' : baixa ? '📉' : '➡️',
      titulo: alta ? `Parcelamentos em alta` : baixa ? `Parcelamentos em queda` : `Parcelamentos estáveis`,
      detalhe: `${signPct2(m.tendenciaPct)} vs média de 6 meses (${fmtR2(m.mediaHistorica6m)})`,
      recomendacao: alta
        ? `Freie novas parcelas nos próximos meses para não comprometer o orçamento`
        : baixa
        ? `Bom momento para não abrir novas parcelas e consolidar a queda`
        : `Mantenha o ritmo atual de parcelamentos`,
      nivel: alta ? 'alerta' : baixa ? 'positivo' : 'info',
    })
  }

  // 3 — Risco em mês futuro
  const risco = m.mesesComRisco[0]
  if (risco) {
    items.push({
      icone: '🔮',
      titulo: `${risco.mes} deve estourar o limite de ${risco.responsavel}`,
      detalhe: `${fmtR2(risco.comprometido)} já comprometido contra limite de ${fmtR2(risco.limite)}`,
      recomendacao: `Não parcele novas compras para ${risco.responsavel} que caiam nesse mês`,
      nivel: 'alerta',
    })
  } else if (m.livreEmCasal) {
    items.push({
      icone: '🏁',
      titulo: `Parcelamentos atuais quitados até ${m.livreEmCasal}`,
      detalhe: m.livreEmPorPessoa.Matheus && m.livreEmPorPessoa.Jeniffer
        ? `Matheus livre em ${m.livreEmPorPessoa.Matheus} · Jeniffer livre em ${m.livreEmPorPessoa.Jeniffer}`
        : `Nenhum mês futuro projetado estoura o limite configurado`,
      recomendacao: `Nenhum risco à vista nos próximos ${HORIZONTE_FUTURO_MESES} meses com os compromissos atuais`,
      nivel: 'positivo',
    })
  }

  // 4 — Categoria líder ou novas parcelas do mês
  const topCat = m.topCategorias[0]
  if (topCat && topCat.percentual > 25) {
    items.push({
      icone: '🏷️',
      titulo: `${topCat.categoria} lidera os parcelamentos`,
      detalhe: `${fmtR2(topCat.valor)} — ${Math.round(topCat.percentual)}% do comprometido do mês`,
      recomendacao: `Antes da próxima compra em ${topCat.categoria}, avalie parcelar menos vezes`,
      nivel: 'info',
    })
  } else if (m.novasParcelasMes > 0) {
    items.push({
      icone: '🆕',
      titulo: `${m.novasParcelasMes} nova${m.novasParcelasMes > 1 ? 's' : ''} compra${m.novasParcelasMes > 1 ? 's' : ''} parcelada${m.novasParcelasMes > 1 ? 's' : ''} este mês`,
      detalhe: `Primeira parcela iniciada em ${m.mesAtualLabel}`,
      recomendacao: `Use o simulador para ver o impacto dessas parcelas nos próximos meses`,
      nivel: 'info',
    })
  }

  return items.slice(0, 4)
}
