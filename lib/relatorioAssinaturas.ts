/**
 * Custo recorrente: o que as assinaturas consomem por mês, por ano, como isso
 * evoluiu nos últimos 12 meses e quanto já foi economizado com pausas.
 *
 * Valor e status são resolvidos pelos históricos (`assinaturas_historico` e
 * `assinaturas_status_historico`), e não pelo estado atual da linha — assim um
 * reajuste feito hoje não reescreve o custo dos meses passados.
 */
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { valorEfetivoNoMes, type HistoricoValorEntry } from './assinaturaValor'
import { ativaEfetivaNoMes, type HistoricoStatusEntry } from './assinaturaStatus'
import { formatBRL } from './format'
import { formatarMes, formatarPercentual, formatarVariacao, variacaoPercentual } from './relatoriosFormat'
import type { DocumentoRelatorio } from './relatorioDocumento'
import type { Destaque } from '@/components/relatorios/DestaquesRelatorio'

const MESES_EVOLUCAO = 12

const CARTAO_LABEL: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

export const RELATORIO_ASSINATURAS_EXPLICACOES = {
  ativas: 'Assinaturas cobradas neste mês, com o valor vigente. O custo anual projeta o valor mensal por 12 meses, sem considerar reajustes futuros.',
  evolucao: 'Custo mensal das assinaturas ativas em cada um dos últimos 12 meses, reconstruído pelo histórico de valor e de status.',
  inativas: 'Assinaturas pausadas ou canceladas. O valor é o que deixou de ser cobrado por mês.',
  calendario: 'Distribuição das cobranças ao longo do mês pelo dia de cobrança cadastrado — ajuda a antecipar os dias de maior saída.',
  reajustes: 'Diferença entre o valor de hoje e o valor vigente 12 meses atrás para cada assinatura ativa.',
} as const

export interface AssinaturaAnalise {
  id: string
  nome: string
  categoria: string
  responsavel: string
  cartao: string
  diaCobranca: number | null
  valorMensal: number
  valorAnual: number
  ativa: boolean
  /** Valor vigente 12 meses atrás, quando havia registro. */
  valorAnterior: number | null
  variacaoAno: number | null
  participacao: number
}

export interface TotalAssinaturas {
  chave: string
  total: number
  quantidade: number
}

export interface RelatorioAssinaturas {
  mesReferencia: Date
  ativas: AssinaturaAnalise[]
  inativas: AssinaturaAnalise[]
  porCategoria: TotalAssinaturas[]
  porResponsavel: TotalAssinaturas[]
  porCartao: TotalAssinaturas[]
  /** Custo mensal total em cada um dos últimos 12 meses. */
  evolucao: { mes: Date; total: number; quantidade: number }[]
  custoMensal: number
  custoAnual: number
  economiaPausadas: number
  erros: string[]
}

type AssinaturaRow = {
  id: string
  nome: string
  valor: number
  cartao: string | null
  responsavel: string | null
  dia_cobranca: number | null
  categoria: string | null
  ativa: boolean
}

function acumular(mapa: Map<string, TotalAssinaturas>, chave: string, valor: number) {
  const atual = mapa.get(chave) ?? { chave, total: 0, quantidade: 0 }
  atual.total += valor
  atual.quantidade += 1
  mapa.set(chave, atual)
}

export async function buscarRelatorioAssinaturas(hoje: Date = new Date()): Promise<RelatorioAssinaturas> {
  const erros: string[] = []
  const mesReferencia = startOfMonth(hoje)
  const cutoffAtual = format(endOfMonth(mesReferencia), 'yyyy-MM-dd')
  const cutoffAnoAtras = format(endOfMonth(subMonths(mesReferencia, MESES_EVOLUCAO)), 'yyyy-MM-dd')

  const [assinaturasRes, historicoRes, statusRes] = await Promise.all([
    supabase.from('assinaturas').select('id, nome, valor, cartao, responsavel, dia_cobranca, categoria, ativa').order('nome'),
    supabase.from('assinaturas_historico').select('assinatura_id, valor, vigente_desde, criado_em'),
    supabase.from('assinaturas_status_historico').select('assinatura_id, ativa, vigente_desde, criado_em'),
  ])

  if (assinaturasRes.error) {
    console.error('[relatorioAssinaturas] Falha ao buscar assinaturas:', assinaturasRes.error)
    erros.push('Não foi possível carregar as assinaturas.')
  }
  if (historicoRes.error) {
    console.error('[relatorioAssinaturas] Falha ao buscar histórico de valores:', historicoRes.error)
    erros.push('Não foi possível carregar o histórico de valores — os meses passados usam o valor atual.')
  }
  if (statusRes.error) {
    console.error('[relatorioAssinaturas] Falha ao buscar histórico de status:', statusRes.error)
    erros.push('Não foi possível carregar o histórico de pausas — os meses passados usam o status atual.')
  }

  const assinaturas = (assinaturasRes.data ?? []) as AssinaturaRow[]
  const historicoValor = (historicoRes.data ?? []) as HistoricoValorEntry[]
  const historicoStatus = (statusRes.data ?? []) as HistoricoStatusEntry[]

  const ativas: AssinaturaAnalise[] = []
  const inativas: AssinaturaAnalise[] = []
  const categorias = new Map<string, TotalAssinaturas>()
  const responsaveis = new Map<string, TotalAssinaturas>()
  const cartoes = new Map<string, TotalAssinaturas>()

  for (const a of assinaturas) {
    const valorMensal = valorEfetivoNoMes(a.id, Number(a.valor ?? 0), cutoffAtual, historicoValor)
    const estaAtiva = ativaEfetivaNoMes(a.id, !!a.ativa, cutoffAtual, historicoStatus)
    const registroAnterior = historicoValor.some(
      h => h.assinatura_id === a.id && h.vigente_desde <= cutoffAnoAtras,
    )
    const valorAnterior = registroAnterior
      ? valorEfetivoNoMes(a.id, Number(a.valor ?? 0), cutoffAnoAtras, historicoValor)
      : null

    const analise: AssinaturaAnalise = {
      id: a.id,
      nome: a.nome,
      categoria: a.categoria || 'Outros',
      responsavel: a.responsavel || 'Compartilhado',
      cartao: CARTAO_LABEL[a.cartao ?? 'nubank'] ?? (a.cartao ?? 'NuBank'),
      diaCobranca: a.dia_cobranca ?? null,
      valorMensal,
      valorAnual: valorMensal * 12,
      ativa: estaAtiva,
      valorAnterior,
      variacaoAno: valorAnterior !== null ? variacaoPercentual(valorMensal, valorAnterior) : null,
      participacao: 0,
    }

    if (estaAtiva) {
      ativas.push(analise)
      acumular(categorias, analise.categoria, valorMensal)
      acumular(responsaveis, analise.responsavel, valorMensal)
      acumular(cartoes, analise.cartao, valorMensal)
    } else {
      inativas.push(analise)
    }
  }

  const custoMensal = ativas.reduce((acc, a) => acc + a.valorMensal, 0)
  for (const a of ativas) a.participacao = custoMensal > 0 ? (a.valorMensal / custoMensal) * 100 : 0

  const evolucao = Array.from({ length: MESES_EVOLUCAO }, (_, i) => {
    const mes = startOfMonth(subMonths(mesReferencia, MESES_EVOLUCAO - 1 - i))
    const cutoff = format(endOfMonth(mes), 'yyyy-MM-dd')
    let total = 0
    let quantidade = 0
    for (const a of assinaturas) {
      if (!ativaEfetivaNoMes(a.id, !!a.ativa, cutoff, historicoStatus)) continue
      total += valorEfetivoNoMes(a.id, Number(a.valor ?? 0), cutoff, historicoValor)
      quantidade += 1
    }
    return { mes, total, quantidade }
  })

  return {
    mesReferencia,
    ativas: ativas.sort((a, b) => b.valorMensal - a.valorMensal),
    inativas: inativas.sort((a, b) => b.valorMensal - a.valorMensal),
    porCategoria: [...categorias.values()].sort((a, b) => b.total - a.total),
    porResponsavel: [...responsaveis.values()].sort((a, b) => b.total - a.total),
    porCartao: [...cartoes.values()].sort((a, b) => b.total - a.total),
    evolucao,
    custoMensal,
    custoAnual: custoMensal * 12,
    economiaPausadas: inativas.reduce((acc, a) => acc + a.valorMensal, 0),
    erros,
  }
}

// ── Leituras (puras) ───────────────────────────────────────────────────────

/** Cobranças agrupadas por semana do mês, pelo dia de cobrança cadastrado. */
export function calendarioCobrancas(relatorio: RelatorioAssinaturas) {
  const faixas = [
    { chave: 'Dias 1 a 7', de: 1, ate: 7 },
    { chave: 'Dias 8 a 14', de: 8, ate: 14 },
    { chave: 'Dias 15 a 21', de: 15, ate: 21 },
    { chave: 'Dias 22 a 31', de: 22, ate: 31 },
    { chave: 'Sem dia definido', de: 0, ate: 0 },
  ]

  return faixas.map(faixa => {
    const itens = relatorio.ativas.filter(a =>
      faixa.de === 0
        ? a.diaCobranca === null
        : a.diaCobranca !== null && a.diaCobranca >= faixa.de && a.diaCobranca <= faixa.ate,
    )
    return {
      chave: faixa.chave,
      total: itens.reduce((acc, a) => acc + a.valorMensal, 0),
      quantidade: itens.length,
    }
  }).filter(f => f.quantidade > 0)
}

export function montarDestaquesAssinaturas(relatorio: RelatorioAssinaturas): Destaque[] {
  const destaques: Destaque[] = []
  if (relatorio.ativas.length === 0) return destaques

  const maisCara = relatorio.ativas[0]
  destaques.push({
    tom: 'neutro',
    titulo: `Assinatura mais cara: ${maisCara.nome} (${formatBRL(maisCara.valorMensal)}/mês)`,
    detalhe: `${formatarPercentual(maisCara.participacao, 0)} do custo recorrente · ${formatBRL(maisCara.valorAnual)} por ano.`,
  })

  destaques.push({
    tom: 'atencao',
    titulo: `${formatBRL(relatorio.custoAnual)} por ano em ${relatorio.ativas.length} assinaturas`,
    detalhe: `Equivale a ${formatBRL(relatorio.custoMensal)} todo mês, antes de qualquer compra.`,
  })

  const primeiro = relatorio.evolucao[0]
  const ultimo = relatorio.evolucao[relatorio.evolucao.length - 1]
  const variacaoAno = primeiro && ultimo ? variacaoPercentual(ultimo.total, primeiro.total) : null
  if (variacaoAno !== null && Math.abs(variacaoAno) >= 5) {
    destaques.push({
      tom: variacaoAno > 0 ? 'atencao' : 'positivo',
      titulo: `Custo recorrente ${variacaoAno > 0 ? 'subiu' : 'caiu'} ${formatarVariacao(variacaoAno)} em 12 meses`,
      detalhe: `${formatBRL(primeiro.total)} em ${formatarMes(primeiro.mes)} → ${formatBRL(ultimo.total)} agora.`,
    })
  }

  const reajustadas = relatorio.ativas
    .filter(a => a.variacaoAno !== null && a.variacaoAno > 10)
    .sort((a, b) => (b.variacaoAno ?? 0) - (a.variacaoAno ?? 0))
    .slice(0, 3)
  if (reajustadas.length > 0) {
    destaques.push({
      tom: 'atencao',
      titulo: `${reajustadas.length} assinatura(s) com reajuste acima de 10% no ano`,
      detalhe: reajustadas
        .map(a => `${a.nome} ${formatarVariacao(a.variacaoAno)}`)
        .join(' · '),
    })
  }

  if (relatorio.economiaPausadas > 0) {
    destaques.push({
      tom: 'positivo',
      titulo: `${formatBRL(relatorio.economiaPausadas)}/mês economizados com ${relatorio.inativas.length} assinatura(s) pausada(s)`,
      detalhe: `São ${formatBRL(relatorio.economiaPausadas * 12)} por ano que deixaram de sair.`,
    })
  }

  const baratas = relatorio.ativas.filter(a => a.valorMensal <= 20)
  if (baratas.length >= 3) {
    const soma = baratas.reduce((acc, a) => acc + a.valorMensal, 0)
    destaques.push({
      tom: 'neutro',
      titulo: `${baratas.length} assinaturas de até R$ 20 somam ${formatBRL(soma)}/mês`,
      detalhe: `Individualmente parecem pequenas, mas custam ${formatBRL(soma * 12)} por ano juntas.`,
    })
  }

  return destaques
}

// ── Documento exportado ────────────────────────────────────────────────────

export function montarDocumentoAssinaturas(relatorio: RelatorioAssinaturas): DocumentoRelatorio {
  return {
    titulo: 'Relatório de Assinaturas',
    subtitulo: `Custo recorrente em ${formatarMes(relatorio.mesReferencia)}`,
    nomeArquivo: `relatorio-assinaturas-${format(relatorio.mesReferencia, 'yyyy-MM')}`,
    avisos: relatorio.erros,
    corCabecalho: [67, 56, 202],
    resumo: [
      { label: 'Custo mensal', valor: relatorio.custoMensal },
      { label: 'Custo anual', valor: relatorio.custoAnual },
      { label: 'Assinaturas ativas', valor: String(relatorio.ativas.length) },
      { label: 'Pausadas/canceladas', valor: String(relatorio.inativas.length) },
      { label: 'Economia com pausas', valor: relatorio.economiaPausadas },
    ],
    secoes: [
      {
        titulo: 'Assinaturas ativas',
        explicacao: RELATORIO_ASSINATURAS_EXPLICACOES.ativas,
        colunas: ['Assinatura', 'Categoria', 'Responsável', 'Cartão', 'Dia', 'Mensal', 'Anual', 'Participação'],
        linhas: relatorio.ativas.map(a => [
          a.nome, a.categoria, a.responsavel, a.cartao,
          a.diaCobranca !== null ? String(a.diaCobranca) : '—',
          a.valorMensal, a.valorAnual, formatarPercentual(a.participacao, 1),
        ]),
        totais: [
          { label: 'Mensal', valor: relatorio.custoMensal },
          { label: 'Anual', valor: relatorio.custoAnual },
        ],
        vazio: 'Nenhuma assinatura ativa.',
      },
      {
        titulo: 'Custo por categoria',
        colunas: ['Categoria', 'Assinaturas', 'Mensal', 'Anual'],
        linhas: relatorio.porCategoria.map(c => [c.chave, String(c.quantidade), c.total, c.total * 12]),
      },
      {
        titulo: 'Custo por responsável',
        colunas: ['Responsável', 'Assinaturas', 'Mensal', 'Anual'],
        linhas: relatorio.porResponsavel.map(r => [r.chave, String(r.quantidade), r.total, r.total * 12]),
      },
      {
        titulo: 'Evolução do custo recorrente (12 meses)',
        explicacao: RELATORIO_ASSINATURAS_EXPLICACOES.evolucao,
        colunas: ['Mês', 'Assinaturas ativas', 'Custo mensal'],
        linhas: relatorio.evolucao.map(e => [formatarMes(e.mes), String(e.quantidade), e.total]),
      },
      {
        titulo: 'Reajustes no ano',
        explicacao: RELATORIO_ASSINATURAS_EXPLICACOES.reajustes,
        colunas: ['Assinatura', 'Valor há 12 meses', 'Valor hoje', 'Variação'],
        linhas: relatorio.ativas
          .filter(a => a.valorAnterior !== null && a.variacaoAno !== null && Math.abs(a.variacaoAno) >= 0.5)
          .map(a => [a.nome, a.valorAnterior ?? 0, a.valorMensal, formatarVariacao(a.variacaoAno)]),
        vazio: 'Nenhum reajuste registrado nos últimos 12 meses.',
      },
      {
        titulo: 'Calendário de cobranças',
        explicacao: RELATORIO_ASSINATURAS_EXPLICACOES.calendario,
        colunas: ['Período do mês', 'Assinaturas', 'Valor'],
        linhas: calendarioCobrancas(relatorio).map(f => [f.chave, String(f.quantidade), f.total]),
      },
      {
        titulo: 'Pausadas e canceladas',
        explicacao: RELATORIO_ASSINATURAS_EXPLICACOES.inativas,
        colunas: ['Assinatura', 'Categoria', 'Responsável', 'Valor que deixou de sair'],
        linhas: relatorio.inativas.map(a => [a.nome, a.categoria, a.responsavel, a.valorMensal]),
        totais: [{ label: 'Economia mensal', valor: relatorio.economiaPausadas }],
        vazio: 'Nenhuma assinatura pausada ou cancelada.',
      },
      {
        titulo: 'Destaques',
        colunas: ['Leitura'],
        linhas: montarDestaquesAssinaturas(relatorio).map(d => [
          d.detalhe ? `${d.titulo} — ${d.detalhe}` : d.titulo,
        ]),
        vazio: 'Sem destaques.',
      },
    ],
    notaRodape:
      'O custo anual projeta o valor mensal atual por 12 meses; reajustes futuros não são estimados. Assinaturas cobradas no cartão também aparecem nas compras da fatura.',
  }
}
