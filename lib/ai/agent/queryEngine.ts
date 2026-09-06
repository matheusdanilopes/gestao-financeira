/**
 * Query Engine — camada de consulta parametrizada sobre os dados financeiros.
 *
 * É a única porta de acesso a dados que o agente de IA enxerga. Cada função
 * recebe filtros já normalizados, opera **em memória** sobre o `EnrichedData`
 * buscado e validado uma única vez por requisição, e devolve um bloco de texto
 * compacto pronto para ser lido pelo modelo.
 *
 * Por que não `run_sql` livre: o modelo nunca toca no banco, não existe
 * superfície de injeção, nenhuma credencial nova é necessária e o custo em
 * tokens fica limitado — cada resposta é agregada e truncada aqui, não pelo
 * modelo.
 *
 * Convenções de data (as mesmas do resto do app):
 *  - Transações são atribuídas ao mês da FATURA (`projeto_fatura`), não ao mês
 *    da compra — ver getMesEfetivo.
 *  - A fatura "atual" é sempre addMonths(hoje, 1): compras feitas depois do
 *    fechamento caem na fatura do mês seguinte.
 *  - Planejamento/receitas usam `mes_referencia` (mês-calendário).
 */

import { format, addMonths, subMonths, startOfMonth, differenceInCalendarDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CATEGORIAS_PADRAO } from '../../categorias'
import { formatBRL } from '../../format'
import {
  getMesEfetivo as mesEfetivo,
  isPlanejamentoDespesaReal,
  cartaoLabelsFromPlanejamento,
  nomeCartao,
} from '../insightsEngine'
import {
  buildContracts,
  buildContratosExtras,
  extrairParcelamento,
  type TransacaoRowParcelamento,
  type PlanejamentoRowParcelamento,
} from '../../parcelamentoProjecao'
import type { EnrichedData, Transacao, Planejamento } from '../types'

// Formato completo (com centavos): o modelo copia estes valores direto para a
// resposta, então uma string como "R$ 209,4" chegaria torta ao usuário.
const R = formatBRL
const RECEITA_PREFIXO = '[RECEITA] '

/** Teto de itens listados individualmente por consulta (custo em tokens). */
const MAX_ITENS_LISTA = 15
/** Teto de linhas por agrupamento (por mês / por categoria / …). */
const MAX_LINHAS_GRUPO = 24

// ─── Formatação ───────────────────────────────────────────────────────────────

export const fmtMes = (yyyyMM: string): string => {
  try { return format(new Date(yyyyMM + '-02'), 'MMM/yy', { locale: ptBR }).toUpperCase() }
  catch { return yyyyMM }
}

const fmtData = (iso?: string | null): string => {
  if (!iso) return '—'
  try { return format(new Date(iso.substring(0, 10) + 'T12:00:00'), 'dd/MM/yy') }
  catch { return iso.substring(0, 10) }
}

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

const share = (parte: number, total: number): string =>
  total > 0 ? `${Math.round((parte / total) * 100)}%` : '0%'

/** Remove acentos e caixa para busca textual tolerante. */
export function normalizar(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

// ─── Normalização de parâmetros vindos do modelo ─────────────────────────────
// Nada vindo do modelo é usado cru: valores inválidos são descartados
// silenciosamente (viram "sem filtro") em vez de gerar erro.

const RESPONSAVEIS_VALIDOS = ['Matheus', 'Jeniffer']
const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2']

/** Aceita 'YYYY-MM' ou 'YYYY-MM-DD'; devolve sempre 'YYYY-MM'. */
export function normalizarMes(mes?: string | null): string | undefined {
  if (typeof mes !== 'string') return undefined
  const m = mes.trim().match(/^(\d{4})-(\d{2})/)
  if (!m) return undefined
  const mesNum = parseInt(m[2], 10)
  if (mesNum < 1 || mesNum > 12) return undefined
  return `${m[1]}-${m[2]}`
}

/**
 * Casa o nome de categoria pedido pelo modelo com uma categoria real.
 * Tolerante a acento/caixa e a variações próximas ("alimentacao", "streaming"),
 * porque o modelo às vezes escreve a categoria com grafia levemente diferente
 * e um match estrito devolveria "nenhum resultado" para um dado que existe.
 */
export function normalizarCategoria(categoria?: string | null): string | undefined {
  if (typeof categoria !== 'string' || !categoria.trim()) return undefined
  const alvo = normalizar(categoria)
  const exata = CATEGORIAS_PADRAO.find(c => normalizar(c) === alvo)
  if (exata) return exata
  return CATEGORIAS_PADRAO.find(c => normalizar(c).startsWith(alvo) || alvo.startsWith(normalizar(c)))
}

function normalizarEnum(valor: unknown, validos: string[]): string | undefined {
  if (typeof valor !== 'string') return undefined
  const alvo = normalizar(valor)
  return validos.find(v => normalizar(v) === alvo)
}

export const normalizarResponsavel = (v?: unknown) => normalizarEnum(v, RESPONSAVEIS_VALIDOS)

/** Aceita tanto o id interno ('cartao1') quanto o nome exibido ('PicPay'). */
export function normalizarCartao(v: unknown, data: EnrichedData): string | undefined {
  if (typeof v !== 'string') return undefined
  const direto = normalizarEnum(v, CARTOES_VALIDOS)
  if (direto) return direto
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const alvo = normalizar(v)
  return Object.entries(labels).find(([, nome]) => normalizar(nome) === alvo)?.[0]
}

function descreverFiltros(partes: Array<string | false | null | undefined>): string {
  const aplicados = partes.filter(Boolean).join(' · ')
  return aplicados || 'nenhum (todo o período disponível)'
}

// ─── Helpers de agregação ────────────────────────────────────────────────────

type Grupo = 'mes' | 'categoria' | 'responsavel' | 'cartao' | 'descricao'

function agrupar<T>(itens: T[], chave: (item: T) => string, valor: (item: T) => number) {
  const mapa = new Map<string, { total: number; count: number }>()
  for (const item of itens) {
    const k = chave(item) || '—'
    const atual = mapa.get(k) ?? { total: 0, count: 0 }
    atual.total += valor(item)
    atual.count += 1
    mapa.set(k, atual)
  }
  return mapa
}

function linhasAgrupamento(
  mapa: Map<string, { total: number; count: number }>,
  totalGeral: number,
  ordem: 'valor' | 'chave' = 'valor'
): string {
  const entradas = [...mapa.entries()]
  entradas.sort(ordem === 'chave'
    ? (a, b) => a[0].localeCompare(b[0])
    : (a, b) => b[1].total - a[1].total)
  const visiveis = entradas.slice(0, MAX_LINHAS_GRUPO)
  const resto = entradas.length - visiveis.length
  const linhas = visiveis
    .map(([k, v]) => `${k}: ${R(v.total)} (${v.count}x, ${share(v.total, totalGeral)})`)
    .join(' · ')
  return resto > 0 ? `${linhas} · [+${resto} não exibidos]` : linhas
}

/**
 * Série mensal em ordem cronológica.
 *
 * Existe separado de linhasAgrupamento porque os rótulos ("OUT/26") ordenam
 * alfabeticamente, não por data — agrupar já formatado embaralharia a série
 * temporal, que é justamente o que o modelo lê para falar de tendência.
 */
function linhasPorMes<T>(itens: T[], mesDoItem: (i: T) => string, valor: (i: T) => number): string {
  const mapa = new Map<string, number>()
  for (const item of itens) {
    const m = mesDoItem(item)
    if (!m) continue
    mapa.set(m, (mapa.get(m) ?? 0) + valor(item))
  }
  const ordenados = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const visiveis = ordenados.slice(-MAX_LINHAS_GRUPO)
  const omitidos = ordenados.length - visiveis.length
  const linha = visiveis.map(([m, v]) => `${fmtMes(m)}: ${R(v)}`).join(' · ')
  return omitidos > 0 ? `[+${omitidos} meses anteriores omitidos] ${linha}` : linha
}

/** Quantos meses distintos aparecem em uma coleção. */
function contarMeses<T>(itens: T[], mesDoItem: (i: T) => string): number {
  return new Set(itens.map(mesDoItem).filter(Boolean)).size
}

/** Lista de meses (YYYY-MM) entre início e fim, inclusive. */
function mesesEntre(inicio: string, fim: string): string[] {
  const out: string[] = []
  const [yi, mi] = inicio.split('-').map(Number)
  const [yf, mf] = fim.split('-').map(Number)
  let cursor = new Date(yi, mi - 1, 1)
  const limite = new Date(yf, mf - 1, 1)
  while (cursor <= limite && out.length < 36) {
    out.push(format(cursor, 'yyyy-MM'))
    cursor = addMonths(cursor, 1)
  }
  return out
}

// ─── Referências temporais ───────────────────────────────────────────────────

export interface Referencias {
  hoje: Date
  /** Mês-calendário corrente (YYYY-MM) — base do planejamento e das receitas. */
  mesCalendario: string
  /** Fatura em formação (YYYY-MM) — addMonths(hoje, 1). */
  mesFatura: string
  diaAtual: number
}

export function construirReferencias(hoje = new Date()): Referencias {
  return {
    hoje,
    mesCalendario: format(hoje, 'yyyy-MM'),
    mesFatura: format(addMonths(hoje, 1), 'yyyy-MM'),
    diaAtual: hoje.getDate(),
  }
}

// ─── 1. Transações de cartão ─────────────────────────────────────────────────

export interface FiltroTransacoes {
  busca?: string
  categoria?: string
  responsavel?: string
  cartao?: string
  mesInicio?: string
  mesFim?: string
  valorMinimo?: number
  valorMaximo?: number
  apenasParceladas?: boolean
  agruparPor?: Grupo
  limite?: number
}

export function consultarTransacoes(data: EnrichedData, f: FiltroTransacoes, refs: Referencias): string {
  const busca = typeof f.busca === 'string' && f.busca.trim() ? normalizar(f.busca) : undefined
  const categoria = normalizarCategoria(f.categoria)
  const responsavel = normalizarResponsavel(f.responsavel)
  const cartao = normalizarCartao(f.cartao, data)
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)
  const valorMin = Number.isFinite(f.valorMinimo) ? Number(f.valorMinimo) : undefined
  const valorMax = Number.isFinite(f.valorMaximo) ? Number(f.valorMaximo) : undefined
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const filtros = descreverFiltros([
    busca && `descrição contém "${f.busca}"`,
    categoria && `categoria=${categoria}`,
    responsavel && `responsável=${responsavel}`,
    cartao && `cartão=${nomeCartao(cartao, labels)}`,
    mesInicio && `fatura de ${fmtMes(mesInicio)}`,
    mesFim && `fatura até ${fmtMes(mesFim)}`,
    valorMin !== undefined && `valor ≥ ${R(valorMin)}`,
    valorMax !== undefined && `valor ≤ ${R(valorMax)}`,
    f.apenasParceladas === true && 'somente parceladas',
  ])

  const encontradas = data.transacoes.filter(t => {
    const m = mesEfetivo(t)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    if (categoria && (t.categoria ?? '') !== categoria) return false
    if (responsavel && t.responsavel !== responsavel) return false
    if (cartao && (t.cartao ?? 'nubank') !== cartao) return false
    if (valorMin !== undefined && t.valor < valorMin) return false
    if (valorMax !== undefined && t.valor > valorMax) return false
    if (f.apenasParceladas === true && !(t.total_parcelas && t.total_parcelas > 1)) return false
    if (busca && !normalizar(t.descricao).includes(busca)) return false
    return true
  })

  const cabecalho = `CONSULTA: transações de cartão (${filtros})`

  if (encontradas.length === 0) {
    return [
      cabecalho,
      'Resultado: nenhuma transação encontrada com esses filtros.',
      'Isso significa que não há registro — não é falta de acesso aos dados. Considere ampliar o período ou remover um filtro antes de concluir.',
    ].join('\n')
  }

  const total = encontradas.reduce((s, t) => s + t.valor, 0)
  const ticket = total / encontradas.length

  const linhas: string[] = [
    cabecalho,
    `Total: ${R(total)} em ${encontradas.length} transação(ões) · ticket médio ${R(ticket)}`,
  ]

  if (contarMeses(encontradas, mesEfetivo) > 1) {
    linhas.push(`Por mês de fatura: ${linhasPorMes(encontradas, mesEfetivo, t => t.valor)}`)
  }

  const grupo = f.agruparPor
  if (grupo === 'categoria' || (!grupo && !categoria && encontradas.length > 3)) {
    const mapa = agrupar(encontradas, t => t.categoria ?? 'Sem categoria', t => t.valor)
    linhas.push(`Por categoria: ${linhasAgrupamento(mapa, total)}`)
  }
  if (grupo === 'responsavel' || (!grupo && !responsavel && encontradas.length > 3)) {
    const mapa = agrupar(encontradas, t => t.responsavel || 'Sem responsável', t => t.valor)
    linhas.push(`Por responsável: ${linhasAgrupamento(mapa, total)}`)
  }
  if (grupo === 'cartao') {
    const mapa = agrupar(encontradas, t => nomeCartao(t.cartao, labels), t => t.valor)
    linhas.push(`Por cartão: ${linhasAgrupamento(mapa, total)}`)
  }
  if (grupo === 'descricao') {
    const mapa = agrupar(encontradas, t => t.descricao.slice(0, 32), t => t.valor)
    linhas.push(`Por estabelecimento: ${linhasAgrupamento(mapa, total)}`)
  }

  const limite = Math.min(Math.max(Number(f.limite) || MAX_ITENS_LISTA, 1), MAX_ITENS_LISTA)
  const itens = [...encontradas].sort((a, b) => b.valor - a.valor).slice(0, limite)
  linhas.push(`Maiores lançamentos (top ${itens.length} de ${encontradas.length}):`)
  for (const t of itens) {
    const parc = t.total_parcelas && t.total_parcelas > 1 ? ` [${t.parcela_atual}/${t.total_parcelas}]` : ''
    linhas.push(
      `  • ${t.descricao.slice(0, 38)}${parc} — ${R(t.valor)} — ${fmtData(t.data)} — ` +
      `${t.responsavel || '—'} — ${nomeCartao(t.cartao, labels)} — ${t.categoria ?? 'sem categoria'} — fatura ${fmtMes(mesEfetivo(t))}`
    )
  }

  if (!mesFim && encontradas.some(t => mesEfetivo(t) === refs.mesFatura)) {
    linhas.push(`Obs.: a fatura de ${fmtMes(refs.mesFatura)} ainda está em formação (hoje é dia ${refs.diaAtual}).`)
  }

  return linhas.join('\n')
}

// ─── 2. Planejamento (despesas fixas) ────────────────────────────────────────

export type StatusPlanejamento = 'todos' | 'pago' | 'aberto' | 'vencido'

export interface FiltroPlanejamento {
  busca?: string
  categoria?: string
  responsavel?: string
  mesInicio?: string
  mesFim?: string
  status?: StatusPlanejamento
  agruparPor?: Grupo
  limite?: number
}

function ehDespesaPlanejada(p: Planejamento): boolean {
  const item = p.item ?? ''
  return !item.startsWith(RECEITA_PREFIXO) && isPlanejamentoDespesaReal(item)
}

const mesDe = (p: Planejamento) => (p.mes_referencia ?? '').substring(0, 7)

export function consultarPlanejamento(data: EnrichedData, f: FiltroPlanejamento, refs: Referencias): string {
  const busca = typeof f.busca === 'string' && f.busca.trim() ? normalizar(f.busca) : undefined
  const categoria = normalizarCategoria(f.categoria)
  const responsavel = normalizarResponsavel(f.responsavel)
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)
  const status: StatusPlanejamento =
    f.status && ['todos', 'pago', 'aberto', 'vencido'].includes(f.status) ? f.status : 'todos'

  const filtros = descreverFiltros([
    busca && `item contém "${f.busca}"`,
    categoria && `categoria=${categoria}`,
    responsavel && `responsável=${responsavel}`,
    mesInicio && `de ${fmtMes(mesInicio)}`,
    mesFim && `até ${fmtMes(mesFim)}`,
    status !== 'todos' && `status=${status}`,
  ])

  const hojeIso = format(refs.hoje, 'yyyy-MM-dd')

  const encontradas = data.planejamento.filter(p => {
    if (!ehDespesaPlanejada(p)) return false
    const m = mesDe(p)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    if (categoria && (p.categoria ?? '') !== categoria) return false
    if (responsavel && p.responsavel !== responsavel) return false
    if (busca && !normalizar(p.item ?? '').includes(busca)) return false
    const pago = Boolean(p.data_pagamento)
    if (status === 'pago' && !pago) return false
    if (status === 'aberto' && pago) return false
    if (status === 'vencido') {
      if (pago) return false
      const venc = (p.data_vencimento ?? '').substring(0, 10)
      if (!venc || venc >= hojeIso) return false
    }
    return true
  })

  const cabecalho = `CONSULTA: despesas planejadas / contas fixas (${filtros})`

  if (encontradas.length === 0) {
    return [
      cabecalho,
      'Resultado: nenhuma despesa planejada encontrada com esses filtros.',
      'Isso significa que não há registro — não é falta de acesso aos dados.',
    ].join('\n')
  }

  const total = encontradas.reduce((s, p) => s + p.valor_previsto, 0)
  const pagas = encontradas.filter(p => p.data_pagamento)
  const totalPago = pagas.reduce((s, p) => s + p.valor_previsto, 0)
  const emAberto = total - totalPago

  const linhas: string[] = [
    cabecalho,
    `Total previsto: ${R(total)} em ${encontradas.length} item(ns) · pago ${R(totalPago)} (${share(totalPago, total)}) · em aberto ${R(emAberto)}`,
  ]

  if (contarMeses(encontradas, mesDe) > 1) {
    linhas.push(`Por mês de referência: ${linhasPorMes(encontradas, mesDe, p => p.valor_previsto)}`)
  }

  if (f.agruparPor === 'categoria' || (!f.agruparPor && !categoria && encontradas.length > 3)) {
    const mapa = agrupar(encontradas, p => p.categoria ?? 'Sem categoria', p => p.valor_previsto)
    linhas.push(`Por categoria: ${linhasAgrupamento(mapa, total)}`)
  }
  if (f.agruparPor === 'responsavel') {
    const mapa = agrupar(encontradas, p => p.responsavel ?? 'Compartilhado', p => p.valor_previsto)
    linhas.push(`Por responsável: ${linhasAgrupamento(mapa, total)}`)
  }

  const limite = Math.min(Math.max(Number(f.limite) || MAX_ITENS_LISTA, 1), MAX_ITENS_LISTA)
  const itens = [...encontradas].sort((a, b) => b.valor_previsto - a.valor_previsto).slice(0, limite)
  linhas.push(`Itens (top ${itens.length} de ${encontradas.length}):`)
  for (const p of itens) {
    const venc = (p.data_vencimento ?? '').substring(0, 10)
    const atrasado = !p.data_pagamento && venc && venc < hojeIso
    const estado = p.data_pagamento ? `pago em ${fmtData(p.data_pagamento)}` : atrasado ? '⚠️ VENCIDO' : 'em aberto'
    const parc = p.total_parcelas && p.total_parcelas > 1 ? ` [${p.parcela_atual}/${p.total_parcelas}]` : ''
    linhas.push(
      `  • ${(p.item ?? '').slice(0, 38)}${parc} — ${R(p.valor_previsto)} — ${fmtMes(mesDe(p))} — ` +
      `venc. ${fmtData(p.data_vencimento)} — ${estado} — ${p.responsavel ?? 'compartilhado'}`
    )
  }

  return linhas.join('\n')
}

// ─── 3. Receitas ([RECEITA]* no planejamento) ────────────────────────────────

export interface FiltroReceitas {
  mesInicio?: string
  mesFim?: string
  responsavel?: string
  status?: 'todos' | 'recebido' | 'aberto'
}

export function consultarReceitas(data: EnrichedData, f: FiltroReceitas, refs: Referencias): string {
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)
  const responsavel = normalizarResponsavel(f.responsavel)
  const status = f.status && ['todos', 'recebido', 'aberto'].includes(f.status) ? f.status : 'todos'

  const filtros = descreverFiltros([
    mesInicio && `de ${fmtMes(mesInicio)}`,
    mesFim && `até ${fmtMes(mesFim)}`,
    responsavel && `responsável=${responsavel}`,
    status !== 'todos' && `status=${status}`,
  ])

  const encontradas = data.planejamento.filter(p => {
    if (!(p.item ?? '').startsWith(RECEITA_PREFIXO)) return false
    const m = mesDe(p)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    if (responsavel && p.responsavel !== responsavel) return false
    if (status === 'recebido' && !p.pago) return false
    if (status === 'aberto' && p.pago) return false
    return true
  })

  const cabecalho = `CONSULTA: receitas / entradas (${filtros})`
  if (encontradas.length === 0) {
    return [cabecalho, 'Resultado: nenhuma receita cadastrada com esses filtros.'].join('\n')
  }

  const nome = (p: Planejamento) => (p.item ?? '').replace(RECEITA_PREFIXO, '')
  const previsto = encontradas.reduce((s, p) => s + p.valor_previsto, 0)
  const recebido = encontradas.filter(p => p.pago).reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0)

  const linhas: string[] = [
    cabecalho,
    `Previsto: ${R(previsto)} em ${encontradas.length} lançamento(s) · já recebido ${R(recebido)} · a receber ${R(previsto - recebido)}`,
  ]

  if (contarMeses(encontradas, mesDe) > 1) {
    linhas.push(`Por mês: ${linhasPorMes(encontradas, mesDe, p => p.valor_previsto)}`)
  }

  const itens = [...encontradas]
    .sort((a, b) => mesDe(b).localeCompare(mesDe(a)) || b.valor_previsto - a.valor_previsto)
    .slice(0, MAX_ITENS_LISTA)
  linhas.push(`Lançamentos (${itens.length} de ${encontradas.length}):`)
  for (const p of itens) {
    const valor = p.pago && p.valor_real != null ? `${R(p.valor_real)} (previsto ${R(p.valor_previsto)})` : R(p.valor_previsto)
    linhas.push(`  • ${nome(p).slice(0, 38)} — ${valor} — ${fmtMes(mesDe(p))} — ${p.pago ? 'recebido' : 'a receber'} — ${p.responsavel ?? 'compartilhado'}`)
  }
  linhas.push(`Referência: mês corrente é ${fmtMes(refs.mesCalendario)}.`)

  return linhas.join('\n')
}

// ─── 4. Assinaturas ──────────────────────────────────────────────────────────

export interface FiltroAssinaturas {
  busca?: string
  status?: 'ativas' | 'canceladas' | 'todas'
  categoria?: string
  responsavel?: string
  cartao?: string
}

export function consultarAssinaturas(data: EnrichedData, f: FiltroAssinaturas): string {
  const busca = typeof f.busca === 'string' && f.busca.trim() ? normalizar(f.busca) : undefined
  const status = f.status && ['ativas', 'canceladas', 'todas'].includes(f.status) ? f.status : 'ativas'
  const categoria = normalizarCategoria(f.categoria)
  const responsavel = typeof f.responsavel === 'string' ? f.responsavel.trim() : undefined
  const cartao = normalizarCartao(f.cartao, data)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const filtros = descreverFiltros([
    busca && `nome contém "${f.busca}"`,
    `status=${status}`,
    categoria && `categoria=${categoria}`,
    responsavel && `responsável=${responsavel}`,
    cartao && `cartão=${nomeCartao(cartao, labels)}`,
  ])

  const encontradas = data.assinaturas.filter(a => {
    if (status === 'ativas' && !a.ativa) return false
    if (status === 'canceladas' && a.ativa) return false
    if (categoria && a.categoria !== categoria) return false
    if (responsavel && normalizar(a.responsavel) !== normalizar(responsavel)) return false
    if (cartao && (a.cartao ?? 'nubank') !== cartao) return false
    if (busca && !normalizar(a.nome).includes(busca)) return false
    return true
  })

  const cabecalho = `CONSULTA: assinaturas (${filtros})`
  if (encontradas.length === 0) {
    return [cabecalho, 'Resultado: nenhuma assinatura encontrada com esses filtros.'].join('\n')
  }

  const total = encontradas.reduce((s, a) => s + a.valor, 0)
  const linhas: string[] = [
    cabecalho,
    `${encontradas.length} assinatura(s) · ${R(total)}/mês · ${R(total * 12)}/ano`,
  ]

  const porCategoria = agrupar(encontradas, a => a.categoria || 'Outros', a => a.valor)
  if (porCategoria.size > 1) linhas.push(`Por categoria: ${linhasAgrupamento(porCategoria, total)}`)

  const porResponsavel = agrupar(encontradas, a => a.responsavel || 'Compartilhado', a => a.valor)
  if (porResponsavel.size > 1) linhas.push(`Por responsável: ${linhasAgrupamento(porResponsavel, total)}`)

  linhas.push('Lista:')
  for (const a of [...encontradas].sort((x, y) => y.valor - x.valor).slice(0, MAX_LINHAS_GRUPO)) {
    linhas.push(
      `  • ${a.nome.slice(0, 32)} — ${R(a.valor)}/mês — ${a.categoria || 'Outros'} — ` +
      `${nomeCartao(a.cartao, labels)} — ${a.responsavel || 'compartilhado'} — ` +
      `${a.ativa ? 'ativa' : 'cancelada'}${a.dia_cobranca ? ` — cobra dia ${a.dia_cobranca}` : ''}`
    )
  }

  return linhas.join('\n')
}

// ─── 5. Investimentos ────────────────────────────────────────────────────────

export interface FiltroInvestimentos {
  mesInicio?: string
  mesFim?: string
}

export function consultarInvestimentos(data: EnrichedData, f: FiltroInvestimentos, refs: Referencias): string {
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)

  const nomePorId = new Map(data.investimentos.map(i => [i.id, i.descricao]))

  const aportes = data.aportes.filter(a => {
    const m = (a.data_aporte ?? '').substring(0, 7)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    return true
  })

  const filtros = descreverFiltros([
    mesInicio && `aportes de ${fmtMes(mesInicio)}`,
    mesFim && `aportes até ${fmtMes(mesFim)}`,
  ])

  const cabecalho = `CONSULTA: investimentos (${filtros})`
  const linhas: string[] = [cabecalho]

  const totalAportado = aportes.reduce((s, a) => s + a.valor, 0)
  const totalHistorico = data.aportes.reduce((s, a) => s + a.valor, 0)

  linhas.push(`Aportes no recorte: ${R(totalAportado)} em ${aportes.length} depósito(s) · total histórico registrado: ${R(totalHistorico)}`)

  if (aportes.length > 0) {
    linhas.push(`Por mês: ${linhasPorMes(aportes, a => (a.data_aporte ?? '').substring(0, 7), a => a.valor)}`)

    const porAtivo = agrupar(aportes, a => nomePorId.get(a.investimento_id) ?? 'Sem identificação', a => a.valor)
    linhas.push(`Por ativo: ${linhasAgrupamento(porAtivo, totalAportado)}`)

    const recentes = [...aportes].sort((a, b) => (b.data_aporte ?? '').localeCompare(a.data_aporte ?? '')).slice(0, 8)
    linhas.push('Aportes recentes:')
    for (const a of recentes) {
      linhas.push(`  • ${(nomePorId.get(a.investimento_id) ?? 'Ativo').slice(0, 32)} — ${R(a.valor)} — ${fmtData(a.data_aporte)}`)
    }
    const ultimo = recentes[0]?.data_aporte
    if (ultimo) {
      const dias = differenceInCalendarDays(refs.hoje, new Date(ultimo.substring(0, 10) + 'T12:00:00'))
      linhas.push(`Último aporte foi há ${dias} dia(s).`)
    }
  } else {
    linhas.push('Nenhum aporte no período consultado.')
  }

  const carteira = data.investimentos.slice(0, 12)
  if (carteira.length > 0) {
    linhas.push(`Carteira (rendimento % no mês de referência): ${carteira.map(i => `${i.descricao} ${i.percentual}% (${fmtMes((i.mes_referencia ?? '').substring(0, 7))})`).join(' · ')}`)
  }

  return linhas.join('\n')
}

// ─── 6. Resumo mensal consolidado ────────────────────────────────────────────

interface ResumoMes {
  mes: string
  faturaTotal: number
  faturaPorCartao: Map<string, { total: number; count: number }>
  fixasPrevistas: number
  fixasPagas: number
  receitasPrevistas: number
  receitasRecebidas: number
  assinaturas: number
}

function calcularResumoMes(data: EnrichedData, mes: string, totalAssinaturas: number): ResumoMes {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const txs = data.transacoes.filter(t => mesEfetivo(t) === mes)
  const fixas = data.planejamento.filter(p => ehDespesaPlanejada(p) && mesDe(p) === mes)
  const receitas = data.planejamento.filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO) && mesDe(p) === mes)

  return {
    mes,
    faturaTotal: txs.reduce((s, t) => s + t.valor, 0),
    faturaPorCartao: agrupar(txs, t => nomeCartao(t.cartao, labels), t => t.valor),
    fixasPrevistas: fixas.reduce((s, p) => s + p.valor_previsto, 0),
    fixasPagas: fixas.filter(p => p.data_pagamento).reduce((s, p) => s + p.valor_previsto, 0),
    receitasPrevistas: receitas.reduce((s, p) => s + p.valor_previsto, 0),
    receitasRecebidas: receitas.filter(p => p.pago).reduce((s, p) => s + (p.valor_real ?? p.valor_previsto), 0),
    assinaturas: totalAssinaturas,
  }
}

export function resumoMensal(
  data: EnrichedData,
  params: { mesInicio?: string; mesFim?: string },
  refs: Referencias
): string {
  const totalAssinaturas = data.assinaturas.filter(a => a.ativa).reduce((s, a) => s + a.valor, 0)

  const inicio = normalizarMes(params.mesInicio) ?? normalizarMes(params.mesFim) ?? refs.mesFatura
  const fim = normalizarMes(params.mesFim) ?? inicio
  const meses = (inicio <= fim ? mesesEntre(inicio, fim) : mesesEntre(fim, inicio)).slice(-12)

  const linhas: string[] = [
    `CONSULTA: resumo consolidado de ${fmtMes(meses[0])} a ${fmtMes(meses[meses.length - 1])}`,
    'Convenção: "fatura" refere-se ao mês de cobrança do cartão; "fixas" e "receitas" ao mês de referência do planejamento.',
  ]

  for (const mes of meses) {
    const r = calcularResumoMes(data, mes, totalAssinaturas)
    const saidas = r.faturaTotal + r.fixasPrevistas
    const saldo = r.receitasPrevistas - saidas
    const cartoes = [...r.faturaPorCartao.entries()].map(([c, v]) => `${c} ${R(v.total)}`).join(' + ') || 'sem lançamentos'
    linhas.push(
      `${fmtMes(mes)} — saídas ${R(saidas)} = fatura ${R(r.faturaTotal)} (${cartoes}) + fixas ${R(r.fixasPrevistas)} ` +
      `(pagas ${R(r.fixasPagas)}) | receitas previstas ${R(r.receitasPrevistas)} (recebidas ${R(r.receitasRecebidas)}) | ` +
      `${saldo >= 0 ? 'sobra' : 'déficit'} ${R(Math.abs(saldo))}`
    )
  }

  linhas.push(`Assinaturas ativas (recorrência já embutida nas faturas): ${R(totalAssinaturas)}/mês.`)
  if (meses.includes(refs.mesFatura)) {
    linhas.push(`Atenção: a fatura de ${fmtMes(refs.mesFatura)} ainda está em formação (hoje é dia ${refs.diaAtual}) — o valor tende a subir até o fechamento.`)
  }

  return linhas.join('\n')
}

// ─── 7. Comparação entre períodos ────────────────────────────────────────────

export interface FiltroComparacao {
  periodoAInicio?: string
  periodoAFim?: string
  periodoBInicio?: string
  periodoBFim?: string
  dimensao?: 'categoria' | 'responsavel' | 'cartao' | 'total'
}

export function compararPeriodos(data: EnrichedData, f: FiltroComparacao, refs: Referencias): string {
  const aIni = normalizarMes(f.periodoAInicio) ?? refs.mesFatura
  const aFim = normalizarMes(f.periodoAFim) ?? aIni
  const bIni = normalizarMes(f.periodoBInicio) ?? format(subMonths(new Date(aIni + '-02'), 1), 'yyyy-MM')
  const bFim = normalizarMes(f.periodoBFim) ?? bIni
  const dimensao = f.dimensao && ['categoria', 'responsavel', 'cartao', 'total'].includes(f.dimensao)
    ? f.dimensao
    : 'categoria'

  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const noIntervalo = (mes: string, ini: string, fim: string) => mes >= ini && mes <= fim

  const txA = data.transacoes.filter(t => noIntervalo(mesEfetivo(t), aIni, aFim))
  const txB = data.transacoes.filter(t => noIntervalo(mesEfetivo(t), bIni, bFim))

  const totalA = txA.reduce((s, t) => s + t.valor, 0)
  const totalB = txB.reduce((s, t) => s + t.valor, 0)
  const variacao = totalB > 0 ? ((totalA - totalB) / totalB) * 100 : 0

  const rotuloA = aIni === aFim ? fmtMes(aIni) : `${fmtMes(aIni)}–${fmtMes(aFim)}`
  const rotuloB = bIni === bFim ? fmtMes(bIni) : `${fmtMes(bIni)}–${fmtMes(bFim)}`

  const linhas: string[] = [
    `CONSULTA: comparação de gastos de cartão — A=${rotuloA} vs B=${rotuloB} (dimensão: ${dimensao})`,
    `Total A: ${R(totalA)} | Total B: ${R(totalB)} | Variação: ${R(totalA - totalB)} (${pct(variacao)})`,
  ]

  if (dimensao !== 'total') {
    const chave = (t: Transacao) =>
      dimensao === 'categoria' ? (t.categoria ?? 'Sem categoria')
      : dimensao === 'responsavel' ? (t.responsavel || 'Sem responsável')
      : nomeCartao(t.cartao, labels)

    const mapaA = agrupar(txA, chave, t => t.valor)
    const mapaB = agrupar(txB, chave, t => t.valor)
    const chaves = [...new Set([...mapaA.keys(), ...mapaB.keys()])]

    const comparacoes = chaves
      .map(k => {
        const va = mapaA.get(k)?.total ?? 0
        const vb = mapaB.get(k)?.total ?? 0
        return { k, va, vb, delta: va - vb, pctVar: vb > 0 ? ((va - vb) / vb) * 100 : (va > 0 ? 100 : 0) }
      })
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, MAX_LINHAS_GRUPO)

    linhas.push('Detalhe (ordenado pelo maior impacto absoluto):')
    for (const c of comparacoes) {
      const sinal = c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '='
      linhas.push(`  ${sinal} ${c.k}: A ${R(c.va)} vs B ${R(c.vb)} → ${R(c.delta)} (${c.vb > 0 ? pct(c.pctVar) : 'novo'})`)
    }
  }

  if ([aIni, aFim, bIni, bFim].includes(refs.mesFatura)) {
    linhas.push(`Atenção: ${fmtMes(refs.mesFatura)} é a fatura em formação — a comparação com um mês fechado é parcial.`)
  }

  return linhas.join('\n')
}

// ─── 8. Projeção de compromissos futuros ─────────────────────────────────────

/**
 * buildContracts deduplica por uma chave que inclui o valor exato — seguro
 * quando alimentado com um snapshot de uma única fatura por cartão (uma linha
 * por parcelamento ativo), mas NÃO com histórico multi-mês: uma variação de
 * centavos entre meses cria "contratos" duplicados e infla a projeção.
 */
function ultimaFaturaSnapshot(transacoes: Transacao[]): Transacao[] {
  const maxPorCartao: Record<string, string> = {}
  for (const t of transacoes) {
    const id = t.cartao ?? 'nubank'
    const mes = mesEfetivo(t)
    if (!maxPorCartao[id] || mes > maxPorCartao[id]) maxPorCartao[id] = mes
  }
  return transacoes.filter(t => mesEfetivo(t) === maxPorCartao[t.cartao ?? 'nubank'])
}

/**
 * Contas fixas recorrentes sem metadados de parcelamento (aluguel, internet…)
 * são invisíveis para buildContratosExtras. Detectadas aqui pelo mesmo critério
 * usado para receitas recorrentes: mesmo nome em ≥2 dos últimos 3 meses.
 */
function mediaFixosRecorrentes(planejamento: Planejamento[], hoje: Date): number {
  const semParcela = planejamento.filter(p =>
    ehDespesaPlanejada(p) && !extrairParcelamento({ ...p, descricao: p.item })
  )
  const meses3 = Array.from({ length: 3 }, (_, i) => format(subMonths(hoje, i), 'yyyy-MM'))
  const porNome = new Map<string, number[]>()
  for (const p of semParcela) {
    if (!meses3.includes(mesDe(p))) continue
    const nome = p.item ?? ''
    if (!nome) continue
    porNome.set(nome, [...(porNome.get(nome) ?? []), p.valor_previsto])
  }
  let total = 0
  for (const valores of porNome.values()) {
    if (valores.length >= 2) total += valores.reduce((s, v) => s + v, 0) / valores.length
  }
  return total
}

export function projecaoFutura(data: EnrichedData, params: { meses?: number }, refs: Referencias): string {
  const nMeses = Math.min(Math.max(Math.round(Number(params.meses) || 6), 1), 12)

  const planejamentoDespesas = data.planejamento.filter(p => !(p.item ?? '').startsWith(RECEITA_PREFIXO))
  const contratos = buildContracts(ultimaFaturaSnapshot(data.transacoes) as unknown as TransacaoRowParcelamento[])
  const contratosExtras = buildContratosExtras(planejamentoDespesas as unknown as PlanejamentoRowParcelamento[])
  const fixosRecorrentes = mediaFixosRecorrentes(planejamentoDespesas, refs.hoje)
  const totalAssinaturas = data.assinaturas.filter(a => a.ativa).reduce((s, a) => s + a.valor, 0)

  const linhas: string[] = [
    `CONSULTA: projeção de compromissos já assumidos — próximos ${nMeses} meses`,
  ]

  for (let i = 0; i < nMeses; i++) {
    const mesRef = startOfMonth(addMonths(refs.hoje, 1 + i))
    const rotulo = fmtMes(format(mesRef, 'yyyy-MM'))

    if (i === 0) {
      const r = calcularResumoMes(data, refs.mesFatura, totalAssinaturas)
      const totalReal = r.faturaTotal + r.fixasPrevistas
      linhas.push(`${rotulo}: ${R(totalReal)} — dado REAL já lançado (fatura ${R(r.faturaTotal)} + fixas ${R(r.fixasPrevistas)}), não é projeção.`)
      continue
    }

    let totalParcelas = 0
    for (const { row, fatura, parcela } of contratos.values()) {
      const delta = (mesRef.getFullYear() - fatura.getFullYear()) * 12 + (mesRef.getMonth() - fatura.getMonth())
      const parcelaNoMes = parcela.atual + delta
      if (parcelaNoMes >= 1 && parcelaNoMes <= parcela.total) totalParcelas += row.valor ?? 0
    }

    let totalFixosParcelados = 0
    for (const { row, mesRef: mesExtra, parcela } of contratosExtras.values()) {
      const diff = (mesRef.getFullYear() - mesExtra.getFullYear()) * 12 + (mesRef.getMonth() - mesExtra.getMonth())
      const restantes = parcela.total - parcela.atual + 1
      if (diff >= 0 && diff < restantes) totalFixosParcelados += row.valor_previsto ?? 0
    }

    const fixos = totalFixosParcelados + fixosRecorrentes
    const total = totalParcelas + fixos + totalAssinaturas
    linhas.push(`${rotulo}: ${R(total)} = parcelas em aberto ${R(totalParcelas)} + fixos recorrentes ${R(fixos)} + assinaturas ${R(totalAssinaturas)}`)
  }

  const receitasFuturas = data.planejamento
    .filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO) && mesDe(p) > refs.mesCalendario)
    .sort((a, b) => mesDe(a).localeCompare(mesDe(b)))
    .slice(0, 8)

  if (receitasFuturas.length > 0) {
    linhas.push(`Receitas futuras já cadastradas: ${receitasFuturas.map(r => `${(r.item ?? '').replace(RECEITA_PREFIXO, '')} ${R(r.valor_previsto)} (${fmtMes(mesDe(r))})`).join(' · ')}`)
  }

  linhas.push('Escopo: apenas compromissos já assumidos (parcelas em aberto, contas fixas recorrentes e assinaturas ativas). NÃO inclui gastos discricionários futuros — o valor real tende a ser maior.')

  return linhas.join('\n')
}

// ─── 9. Dimensões disponíveis (grounding) ────────────────────────────────────

export function listarDimensoes(data: EnrichedData, refs: Referencias): string {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const mesesTx = [...new Set(data.transacoes.map(mesEfetivo).filter(Boolean))].sort()
  const mesesPl = [...new Set(data.planejamento.map(mesDe).filter(Boolean))].sort()

  const categoriasUsadas = new Map<string, number>()
  for (const t of data.transacoes) {
    const c = t.categoria ?? 'Sem categoria'
    categoriasUsadas.set(c, (categoriasUsadas.get(c) ?? 0) + 1)
  }
  const cartoesUsados = [...new Set(data.transacoes.map(t => t.cartao ?? 'nubank'))]
  const responsaveis = [...new Set(data.transacoes.map(t => t.responsavel).filter(Boolean))]

  return [
    'CONSULTA: dimensões disponíveis nos dados (use estes valores exatos nos filtros)',
    `Hoje: ${format(refs.hoje, "dd/MM/yyyy", { locale: ptBR })} · mês-calendário ${refs.mesCalendario} · fatura em formação ${refs.mesFatura}`,
    `Transações de cartão: ${data.transacoes.length} registros, faturas de ${mesesTx[0] ?? '—'} a ${mesesTx[mesesTx.length - 1] ?? '—'}`,
    `Planejamento: ${data.planejamento.length} registros, referências de ${mesesPl[0] ?? '—'} a ${mesesPl[mesesPl.length - 1] ?? '—'}`,
    `Categorias com lançamentos: ${[...categoriasUsadas.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(' · ')}`,
    `Categorias válidas no sistema: ${CATEGORIAS_PADRAO.join(' · ')}`,
    `Cartões: ${cartoesUsados.map(id => `${id} = "${nomeCartao(id, labels)}"`).join(' · ')}`,
    `Responsáveis: ${responsaveis.join(' · ') || '—'}`,
    `Assinaturas cadastradas: ${data.assinaturas.length} (${data.assinaturas.filter(a => a.ativa).length} ativas)`,
    `Investimentos: ${data.investimentos.length} ativo(s), ${data.aportes.length} aporte(s) registrados`,
  ].join('\n')
}

// ─── 10. Estornos (explicam diferenças de fatura) ────────────────────────────

export function consultarEstornos(data: EnrichedData, params: { mesInicio?: string; mesFim?: string }): string {
  const mesInicio = normalizarMes(params.mesInicio)
  const mesFim = normalizarMes(params.mesFim)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const encontrados = data.estornos.filter(e => {
    const m = (e.projeto_fatura ?? '').substring(0, 7)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    return true
  })

  if (encontrados.length === 0) {
    return 'CONSULTA: estornos — nenhum estorno registrado no período (janela disponível: últimos 3 meses).'
  }

  const total = encontrados.reduce((s, e) => s + Math.abs(e.valor), 0)
  const linhas = [
    `CONSULTA: estornos (${encontrados.length} registro(s), ${R(total)})`,
    'Estornos JÁ ESTÃO EXCLUÍDOS dos totais de fatura — servem para explicar por que uma compra sumiu ou o valor caiu.',
  ]
  for (const e of encontrados.slice(0, MAX_ITENS_LISTA)) {
    linhas.push(`  • ${e.descricao.slice(0, 38)} — ${R(Math.abs(e.valor))} — ${fmtData(e.data)} — ${nomeCartao(e.cartao, labels)} — fatura ${fmtMes((e.projeto_fatura ?? '').substring(0, 7))} — ${e.status}`)
  }
  return linhas.join('\n')
}
