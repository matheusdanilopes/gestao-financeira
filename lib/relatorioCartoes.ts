import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import {
  buildContracts,
  buildContratosExtras,
  type TransacaoRowParcelamento,
  type PlanejamentoRowParcelamento,
} from './parcelamentoProjecao'

const MESES_HISTORICO = 12
const MESES_PROJECAO = 12
const JANELA_PARCELAS_MESES = 36

export interface MesGasto {
  mes: Date
  total: number
  matheus: number
  jeniffer: number
  conjunto: number
}

export interface ParcelamentoAberto {
  descricao: string
  responsavel: string
  origem: 'nubank' | 'cartao1' | 'cartao2' | 'planejamento'
  valorParcela: number
  parcelaAtual: number
  totalParcelas: number
  parcelasRestantes: number
  valorRestante: number
  mesTermino: Date
}

export interface RelatorioCartoes {
  historico: MesGasto[]
  projecao: MesGasto[]
  parcelamentosAbertos: ParcelamentoAberto[]
  erros: string[]
}

export const RELATORIO_CARTOES_EXPLICACOES = {
  historico: 'Total gasto no cartão em cada um dos últimos 12 meses, com a divisão por responsável (estornos não são contabilizados).',
  projecao: 'Projeção das parcelas já lançadas para os próximos 12 meses, a partir do mês atual, com a divisão por responsável. Não inclui compras futuras ainda não realizadas.',
  parcelamentosAbertos: 'Parcelamentos em aberto reconstruídos a partir da fatura mais recente de cada cartão, mostrando quantas parcelas ainda faltam e quando cada um termina.',
} as const

function novoMesGasto(mes: Date): MesGasto {
  return { mes, total: 0, matheus: 0, jeniffer: 0, conjunto: 0 }
}

function somarPorResponsavel(bucket: MesGasto, responsavel: string | null | undefined, valor: number) {
  bucket.total += valor
  if (responsavel === 'Matheus') bucket.matheus += valor
  else if (responsavel === 'Jeniffer') bucket.jeniffer += valor
  else bucket.conjunto += valor
}

async function buscarHistorico(hoje: Date, erros: string[]): Promise<MesGasto[]> {
  const meses = Array.from({ length: MESES_HISTORICO }, (_, i) => startOfMonth(subMonths(hoje, MESES_HISTORICO - 1 - i)))
  const faturas = meses.map(m => format(m, 'yyyy-MM-dd'))
  const bucketsPorFatura = new Map<string, MesGasto>()
  for (let i = 0; i < meses.length; i++) bucketsPorFatura.set(faturas[i], novoMesGasto(meses[i]))

  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('valor, responsavel, projeto_fatura')
    .in('projeto_fatura', faturas)
    .neq('status', 'ESTORNO')
    .neq('status', 'ESTORNADO')

  if (error) {
    console.error('[relatorioCartoes] Falha ao buscar histórico de gastos:', error)
    erros.push('Não foi possível carregar o histórico de gastos do cartão.')
  }

  for (const row of (data ?? []) as { valor: number; responsavel: string | null; projeto_fatura: string }[]) {
    const bucket = bucketsPorFatura.get(row.projeto_fatura)
    if (bucket) somarPorResponsavel(bucket, row.responsavel, row.valor)
  }

  return meses.map(m => bucketsPorFatura.get(format(m, 'yyyy-MM-dd'))!)
}

async function buscarBaseContratos(erros: string[]) {
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
    for (const r of resultados) {
      if (r.error) {
        console.error('[relatorioCartoes] Falha ao buscar fatura mais recente:', r.error)
        erros.push('Não foi possível carregar a base para a projeção de parcelas.')
      }
    }
    transacoesUltimaFatura = resultados.flatMap(r => (r.data ?? []) as TransacaoRowParcelamento[])
  }

  const janelaInicio = format(subMonths(new Date(), JANELA_PARCELAS_MESES), 'yyyy-MM-dd')
  const { data: todasDespesas, error: errorDespesas } = await supabase
    .from('planejamento')
    .select('*')
    .not('item', 'ilike', '[RECEITA]%')
    .gte('mes_referencia', janelaInicio)

  if (errorDespesas) {
    console.error('[relatorioCartoes] Falha ao buscar despesas parceladas do planejamento:', errorDespesas)
    erros.push('Não foi possível carregar despesas parceladas do planejamento.')
  }

  return {
    contratos: buildContracts(transacoesUltimaFatura),
    contratosExtras: buildContratosExtras((todasDespesas ?? []) as PlanejamentoRowParcelamento[]),
  }
}

function calcularProjecao(
  hoje: Date,
  contratos: ReturnType<typeof buildContracts>,
  contratosExtras: ReturnType<typeof buildContratosExtras>,
): MesGasto[] {
  const meses = Array.from({ length: MESES_PROJECAO }, (_, i) => startOfMonth(addMonths(hoje, i + 1)))
  const buckets = meses.map(novoMesGasto)

  for (let i = 0; i < meses.length; i++) {
    const mesRef = meses[i]

    for (const { row, fatura, parcela } of contratos.values()) {
      const deltaM = (mesRef.getFullYear() - fatura.getFullYear()) * 12 + (mesRef.getMonth() - fatura.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
        somarPorResponsavel(buckets[i], row.responsavel, Number(row.valor ?? 0))
      }
    }

    for (const { row: e, mesRef: mesExtra, parcela } of contratosExtras.values()) {
      const deltaM = (mesRef.getFullYear() - mesExtra.getFullYear()) * 12 + (mesRef.getMonth() - mesExtra.getMonth())
      const parcelaNoMes = parcela.atual + deltaM
      if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) {
        somarPorResponsavel(buckets[i], e.responsavel, Number(e.valor_previsto ?? 0))
      }
    }
  }

  return buckets
}

function derivarParcelamentosAbertos(
  hoje: Date,
  contratos: ReturnType<typeof buildContracts>,
  contratosExtras: ReturnType<typeof buildContratosExtras>,
): ParcelamentoAberto[] {
  const hojeInicio = startOfMonth(hoje)
  const abertos: ParcelamentoAberto[] = []

  for (const { row, fatura, parcela } of contratos.values()) {
    const origem = subMonths(fatura, parcela.atual - 1)
    const mesTermino = addMonths(origem, parcela.total - 1)
    const parcelasRestantes = (mesTermino.getFullYear() - hojeInicio.getFullYear()) * 12 + (mesTermino.getMonth() - hojeInicio.getMonth()) + 1
    if (parcelasRestantes <= 0) continue

    const valor = Number(row.valor ?? 0)
    abertos.push({
      descricao: String(row.descricao ?? ''),
      responsavel: String(row.responsavel ?? ''),
      origem: (row.cartao as 'nubank' | 'cartao1' | 'cartao2') ?? 'nubank',
      valorParcela: valor,
      parcelaAtual: parcela.total - parcelasRestantes + 1,
      totalParcelas: parcela.total,
      parcelasRestantes,
      valorRestante: valor * parcelasRestantes,
      mesTermino,
    })
  }

  for (const { row: e, mesRef, parcela } of contratosExtras.values()) {
    const origem = subMonths(mesRef, parcela.atual - 1)
    const mesTermino = addMonths(origem, parcela.total - 1)
    const parcelasRestantes = (mesTermino.getFullYear() - hojeInicio.getFullYear()) * 12 + (mesTermino.getMonth() - hojeInicio.getMonth()) + 1
    if (parcelasRestantes <= 0) continue

    const valor = Number(e.valor_previsto ?? 0)
    abertos.push({
      descricao: String(e.item ?? ''),
      responsavel: String(e.responsavel ?? ''),
      origem: 'planejamento',
      valorParcela: valor,
      parcelaAtual: parcela.total - parcelasRestantes + 1,
      totalParcelas: parcela.total,
      parcelasRestantes,
      valorRestante: valor * parcelasRestantes,
      mesTermino,
    })
  }

  return abertos.sort((a, b) => a.mesTermino.getTime() - b.mesTermino.getTime())
}

export async function buscarRelatorioCartoes(hoje: Date = new Date()): Promise<RelatorioCartoes> {
  const erros: string[] = []

  const [historico, { contratos, contratosExtras }] = await Promise.all([
    buscarHistorico(hoje, erros),
    buscarBaseContratos(erros),
  ])

  const projecao = calcularProjecao(hoje, contratos, contratosExtras)
  const parcelamentosAbertos = derivarParcelamentosAbertos(hoje, contratos, contratosExtras)

  return { historico, projecao, parcelamentosAbertos, erros }
}
