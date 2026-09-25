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

import { format, addMonths, subMonths, differenceInCalendarDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '../../categorias'
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
import { tipoCartaoPorItem, removerPrefixoCartao } from '../../tipoCartao'
import { agoraBrasil } from '../tempo'

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

// ─── Busca textual tolerante ─────────────────────────────────────────────────
// A descrição da fatura raramente é o nome da loja: vem com prefixo de
// maquininha ("PG *LOJA", "MP*LOJA", "IFD*IFOOD"), sufixo de parcela e números
// soltos. Uma busca literal por "loja x" não achava "PG *LOJAX" e o modelo
// concluía "você não comprou lá".

const PREFIXO_MAQUININHA =
  /^(?:pg|pag|pags|pagseguro|mp|mercadopago|merpago|ec|ifd|dl|dm|sumup|stone|cielo|pp|paypal|sq|zp|htm|ebn|ton|getnet|rede|pic|picpay)\s*\*\s*/i

/** Nome "limpo" da descrição: sem prefixo de maquininha, sufixo de parcela e asteriscos. */
export function limparDescricao(descricao: string): string {
  const limpa = (descricao ?? '')
    .replace(PREFIXO_MAQUININHA, '')
    .replace(/\s*[-–]?\s*parcela\s*\d+\s*\/\s*\d+.*$/i, '')
    .replace(/\s+\d{1,2}\/\d{1,2}\s*$/, '')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return limpa || (descricao ?? '').trim()
}

const textoDeBusca = (s: string) => normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * A descrição casa com a busca se: contém o texto (sem acento/pontuação), ou o
 * contém ignorando espaços ("mercado livre" × "MERCADOLIVRE"), ou contém todas
 * as palavras da busca em qualquer ordem.
 */
export function casaBusca(descricao: string, busca: string): boolean {
  const d = textoDeBusca(descricao)
  const b = textoDeBusca(busca)
  if (!b) return true
  if (d.includes(b)) return true
  const bJunto = b.replace(/ /g, '')
  if (bJunto.length >= 3 && d.replace(/ /g, '').includes(bJunto)) return true
  const palavras = b.split(' ').filter(p => p.length >= 2)
  return palavras.length > 1 && palavras.every(p => d.includes(p))
}

/** Descrições dos dados parecidas com a busca, para quando ela não encontra nada. */
function sugerirDescricoes(descricoes: string[], busca: string): string[] {
  const termos = textoDeBusca(busca).split(' ').filter(t => t.length >= 3)
  if (termos.length === 0) return []
  const frequencia = new Map<string, number>()
  for (const descricao of descricoes) {
    const nome = limparDescricao(descricao)
    const palavras = textoDeBusca(nome).split(' ').filter(w => w.length >= 3)
    const parecida = termos.some(t => palavras.some(w =>
      w.startsWith(t.slice(0, 4)) || distanciaEdicao(t, w) <= (t.length <= 5 ? 1 : 2)
    ))
    if (parecida) frequencia.set(nome, (frequencia.get(nome) ?? 0) + 1)
  }
  return [...frequencia.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nome]) => nome)
}

function linhaSugestoes(descricoes: string[], busca: string | undefined): string | null {
  if (!busca) return null
  const sugestoes = sugerirDescricoes(descricoes, busca)
  return sugestoes.length > 0
    ? `Descrições parecidas que existem nos dados: ${sugestoes.map(x => `"${x}"`).join(', ')}. Se alguma for o que o usuário quis dizer, refaça a busca com ela.`
    : `Nenhuma descrição parecida com "${busca}" nos dados.`
}

// ─── Normalização de parâmetros vindos do modelo ─────────────────────────────
// Nada vindo do modelo é usado cru: valores inválidos são descartados
// silenciosamente (viram "sem filtro") em vez de gerar erro.

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2']

// ─── Mês do app × mês de projeto_fatura ──────────────────────────────────────
// O app guarda cada compra sob `projeto_fatura`, o mês em que ela será COBRADA.
// Mas o Dashboard — a tela onde o usuário lê os totais — mostra, para o mês M
// do seletor, a fatura de projeto_fatura M+1 (a que FECHA durante M). Ou seja:
// a fatura em formação pertence ao mês CORRENTE no vocabulário do app, não ao
// mês seguinte.
//
// Esta é a fonte de um erro real: o agente falava em "fatura de outubro" para a
// mesma fatura que o Dashboard rotula "Setembro", e o usuário lia como número
// errado. Toda API deste módulo fala o mês do app; a tradução para
// projeto_fatura acontece só aqui dentro.
//
// (A tela de Compras usa a convenção oposta — mês do seletor = projeto_fatura.
// Entre as duas, a do Dashboard é a que casa com a linguagem natural: a fatura
// de setembro é a que contém as compras feitas em setembro.)

const somarMeses = (mes: string, delta: number): string => {
  const [ano, m] = mes.split('-').map(Number)
  return format(addMonths(new Date(ano, m - 1, 1), delta), 'yyyy-MM')
}

/** Mês do app (seletor do Dashboard) → projeto_fatura correspondente. */
export const faturaDoMes = (mesApp: string): string => somarMeses(mesApp, 1)

/** projeto_fatura → mês do app em que essa fatura aparece. */
export const mesDaFatura = (projetoFatura: string): string => somarMeses(projetoFatura, -1)

/** Rótulo de uma transação no vocabulário do app. */
const mesAppDaTransacao = (t: Transacao): string => mesDaFatura(mesEfetivo(t))

/**
 * Responsáveis existentes NOS DADOS, não uma lista fixa.
 *
 * Havia um enum fixo ['Matheus','Jeniffer'] aqui — que descartava em silêncio
 * um filtro por "Conjunto" (um responsável real, com R$ 1.068,04 na fatura do
 * print do usuário) e devolvia o total de todo mundo como se fosse dele.
 */
function responsaveisConhecidos(data: EnrichedData): string[] {
  const set = new Set<string>()
  for (const t of data.transacoes) if (t.responsavel) set.add(t.responsavel)
  for (const p of data.planejamento) if (p.responsavel) set.add(p.responsavel)
  for (const a of data.assinaturas) if (a.responsavel) set.add(a.responsavel)
  return [...set].sort()
}

/** Aceita 'YYYY-MM' ou 'YYYY-MM-DD'; devolve sempre 'YYYY-MM'. */
export function normalizarMes(mes?: string | null): string | undefined {
  if (typeof mes !== 'string') return undefined
  const m = mes.trim().match(/^(\d{4})-(\d{2})/)
  if (!m) return undefined
  const mesNum = parseInt(m[2], 10)
  if (mesNum < 1 || mesNum > 12) return undefined
  return `${m[1]}-${m[2]}`
}

// ─── Resolução de filtros vindos do modelo ───────────────────────────────────
// Um filtro que não casa com nada NÃO pode virar "sem filtro": foi assim que
// "Jenifer" (grafia errada) devolveu o total do casal inteiro como se fosse
// dela. Agora ou o valor casa — exato, por prefixo único ou com 1–2 letras de
// diferença — ou a consulta falha com a lista de valores válidos, e o modelo
// refaz a chamada.

/** Filtro que não corresponde a nenhum valor real. A mensagem vai direto para o modelo. */
export class FiltroInvalido extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FiltroInvalido'
  }
}

/** Palavras que o modelo às vezes manda querendo dizer "sem filtro". */
const SEM_FILTRO = new Set(['todos', 'todas', 'ambos', 'ambas', 'geral', 'qualquer', 'tudo', '*'])

function distanciaEdicao(a: string, b: string): number {
  const linha = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = linha[0]
    linha[0] = i
    for (let j = 1; j <= b.length; j++) {
      const acima = linha[j]
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = acima
    }
  }
  return linha[b.length]
}

/**
 * Casa `pedido` com um dos `candidatos` (comparação sem acento/caixa).
 * `apelidos` mapeia grafias alternativas (ex.: nome exibido do cartão → id).
 */
function resolverValor(
  pedido: unknown,
  candidatos: string[],
  rotulo: string,
  apelidos: Record<string, string> = {}
): string | undefined {
  if (typeof pedido !== 'string' || !pedido.trim()) return undefined
  const alvo = normalizar(pedido)
  if (SEM_FILTRO.has(alvo)) return undefined

  const opcoes = new Map<string, string>()
  for (const c of candidatos) opcoes.set(normalizar(c), c)
  for (const [apelido, valor] of Object.entries(apelidos)) opcoes.set(normalizar(apelido), valor)

  const exato = opcoes.get(alvo)
  if (exato) return exato

  const unico = (lista: string[]) => {
    const valores = [...new Set(lista.map(k => opcoes.get(k)!))]
    return valores.length === 1 ? valores[0] : undefined
  }

  if (alvo.length >= 3) {
    const porPrefixo = unico([...opcoes.keys()].filter(k => k.startsWith(alvo) || alvo.startsWith(k)))
    if (porPrefixo) return porPrefixo
  }

  const tolerancia = alvo.length <= 4 ? 1 : 2
  let melhor = Infinity
  let achados: string[] = []
  for (const k of opcoes.keys()) {
    const d = distanciaEdicao(alvo, k)
    if (d < melhor) { melhor = d; achados = [k] }
    else if (d === melhor) achados.push(k)
  }
  if (melhor <= tolerancia) {
    const aproximado = unico(achados)
    if (aproximado) return aproximado
  }

  throw new FiltroInvalido(
    `${rotulo} "${pedido}" não existe nos dados. Valores válidos: ${[...new Set(candidatos)].join(', ') || '—'}. ` +
    'Refaça a consulta com um desses valores (ou sem o filtro). Nunca apresente um total sem filtro como se fosse filtrado.'
  )
}

/** Categorias possíveis: as padrão, as personalizadas em Configurações e as que aparecem nos dados. */
function categoriasConhecidas(data: EnrichedData): string[] {
  const set = new Set<string>(CATEGORIAS_PADRAO)
  const config = data.configuracoes.find(c => c.chave === 'categorias_compras')?.valor
  if (config) for (const c of parseCategoriasConfig(config)) set.add(c)
  for (const t of data.transacoes) if (t.categoria) set.add(t.categoria)
  for (const p of data.planejamento) if (p.categoria) set.add(p.categoria)
  for (const a of data.assinaturas) if (a.categoria) set.add(a.categoria)
  return [...set]
}

export const resolverCategoria = (v: unknown, data: EnrichedData) =>
  resolverValor(v, categoriasConhecidas(data), 'Categoria')

export const resolverResponsavel = (v: unknown, data: EnrichedData) =>
  resolverValor(v, responsaveisConhecidos(data), 'Responsável')

/** Aceita tanto o id interno ('cartao1') quanto o nome exibido ('PicPay'). */
export function resolverCartao(v: unknown, data: EnrichedData): string | undefined {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const apelidos: Record<string, string> = { nu: 'nubank', 'nu bank': 'nubank' }
  for (const [id, nome] of Object.entries(labels)) apelidos[nome] = id
  return resolverValor(v, CARTOES_VALIDOS, 'Cartão', apelidos)
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

/**
 * Média, mediana, maior e menor de uma série mensal — calculadas aqui para o
 * modelo não fazer conta de cabeça (é onde ele mais erra). Com `meses`, os meses
 * sem lançamento entram como zero em vez de sumirem da média.
 */
function estatisticasMensais<T>(
  itens: T[],
  mesDoItem: (i: T) => string,
  valor: (i: T) => number,
  meses?: string[]
): string | null {
  const mapa = new Map<string, number>()
  for (const m of meses ?? []) mapa.set(m, 0)
  for (const item of itens) {
    const m = mesDoItem(item)
    if (!m || (meses && !mapa.has(m))) continue
    mapa.set(m, (mapa.get(m) ?? 0) + valor(item))
  }
  const serie = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (serie.length < 2) return null
  const valores = serie.map(([, v]) => v)
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  const mediana = ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2
  const media = valores.reduce((s, v) => s + v, 0) / valores.length
  const maior = serie.reduce((a, b) => (b[1] > a[1] ? b : a))
  const menor = serie.reduce((a, b) => (b[1] < a[1] ? b : a))
  return `Estatística de ${serie.length} meses: média ${R(media)}/mês · mediana ${R(mediana)} · maior ${fmtMes(maior[0])} ${R(maior[1])} · menor ${fmtMes(menor[0])} ${R(menor[1])}`
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
  /**
   * Mês corrente no vocabulário do app (YYYY-MM). Vale para TUDO: contas fixas,
   * receitas e também a fatura de cartão em formação — é o mês que o usuário vê
   * no seletor do Dashboard.
   */
  mesApp: string
  /** Mês do app anterior — última fatura fechada e contas fixas do mês passado. */
  mesAppAnterior: string
  /** projeto_fatura da fatura em formação. Uso interno; nunca vai para o texto. */
  faturaEmFormacao: string
  diaAtual: number
}

export function construirReferencias(hoje: Date = agoraBrasil()): Referencias {
  const mesApp = format(hoje, 'yyyy-MM')
  return {
    hoje,
    mesApp,
    mesAppAnterior: somarMeses(mesApp, -1),
    faturaEmFormacao: faturaDoMes(mesApp),
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
  ordenarPor?: 'valor' | 'data'
  pagina?: number
}

/**
 * Aviso para quando o período pedido passa da última fatura importada de algum
 * cartão do escopo: "nenhum lançamento" ali é ausência de dado, não zero.
 */
function avisoMesesNaoImportados(data: EnrichedData, cartoesEscopo: string[], faturaAlvo?: string): string | null {
  const ultimas = ultimaFaturaPorCartao(data.transacoes)
  const menorUltima = cartoesEscopo.map(c => ultimas[c]).filter(Boolean).sort()[0]
  if (!menorUltima || !faturaAlvo || faturaAlvo <= menorUltima) return null
  return `AVISO: faturas importadas: ${descreverUltimasFaturas(data, cartoesEscopo)}. Meses depois disso ainda não têm lançamentos no banco — ` +
    'a ausência de compras ali NÃO significa valor zero. Para parcelas nesses meses use projetar_parcelamentos; para compromissos em geral, projecao_futura.'
}

export function consultarTransacoes(data: EnrichedData, f: FiltroTransacoes, refs: Referencias): string {
  const busca = typeof f.busca === 'string' && f.busca.trim() ? f.busca.trim() : undefined
  const categoria = resolverCategoria(f.categoria, data)
  const responsavel = resolverResponsavel(f.responsavel, data)
  const cartao = resolverCartao(f.cartao, data)
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)
  const valorMin = Number.isFinite(f.valorMinimo) ? Number(f.valorMinimo) : undefined
  const valorMax = Number.isFinite(f.valorMaximo) ? Number(f.valorMaximo) : undefined
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  // Os meses chegam no vocabulário do app e são traduzidos para projeto_fatura
  // antes de tocar nos dados.
  const faturaInicio = mesInicio ? faturaDoMes(mesInicio) : undefined
  const faturaFim = mesFim ? faturaDoMes(mesFim) : undefined

  const filtros = descreverFiltros([
    busca && `descrição contém "${busca}"`,
    categoria && `categoria=${categoria}`,
    responsavel && `responsável=${responsavel}`,
    cartao && `cartão=${nomeCartao(cartao, labels)}`,
    // "a partir de" / "até" explícitos: um intervalo aberto rotulado como um
    // mês só fazia o total de vários meses ser lido como o de um.
    mesInicio && mesFim && mesInicio === mesFim && `mês ${fmtMes(mesInicio)}`,
    mesInicio && (!mesFim || mesInicio !== mesFim) && `a partir de ${fmtMes(mesInicio)}`,
    mesFim && (!mesInicio || mesInicio !== mesFim) && `até ${fmtMes(mesFim)}`,
    valorMin !== undefined && `valor ≥ ${R(valorMin)}`,
    valorMax !== undefined && `valor ≤ ${R(valorMax)}`,
    f.apenasParceladas === true && 'somente parceladas',
  ])

  const encontradas = data.transacoes.filter(t => {
    const m = mesEfetivo(t)
    if (faturaInicio && m < faturaInicio) return false
    if (faturaFim && m > faturaFim) return false
    if (categoria && (t.categoria ?? '') !== categoria) return false
    if (responsavel && t.responsavel !== responsavel) return false
    if (cartao && (t.cartao ?? 'nubank') !== cartao) return false
    if (valorMin !== undefined && t.valor < valorMin) return false
    if (valorMax !== undefined && t.valor > valorMax) return false
    if (f.apenasParceladas === true && !(t.total_parcelas && t.total_parcelas > 1)) return false
    if (busca && !casaBusca(t.descricao, busca)) return false
    return true
  })

  const cabecalho = `CONSULTA: transações de cartão (${filtros})`

  const ultimas = ultimaFaturaPorCartao(data.transacoes)
  const cartoesEscopo = cartao ? [cartao] : Object.keys(ultimas)
  const avisoFuturo = avisoMesesNaoImportados(data, cartoesEscopo, faturaFim ?? faturaInicio)

  if (encontradas.length === 0) {
    return [
      cabecalho,
      'Resultado: nenhuma transação encontrada com esses filtros.',
      avisoFuturo ?? 'Isso significa que não há registro — não é falta de acesso aos dados. Considere ampliar o período ou remover um filtro antes de concluir.',
      linhaSugestoes(data.transacoes.map(t => t.descricao), busca),
    ].filter(Boolean).join('\n')
  }

  const total = encontradas.reduce((s, t) => s + t.valor, 0)
  const ticket = total / encontradas.length
  const nMeses = contarMeses(encontradas, mesAppDaTransacao)

  const linhas: string[] = [
    cabecalho,
    `Total: ${R(total)} em ${encontradas.length} transação(ões) · ticket médio ${R(ticket)}`,
  ]

  // Meses do intervalo pedido (limitados ao que já foi importado), para que um
  // mês sem compra entre como zero na média em vez de sumir dela.
  const ultimaImportada = cartoesEscopo.map(c => ultimas[c]).filter(Boolean).sort().pop()
  const mesesDoIntervalo = mesInicio && mesFim && ultimaImportada
    ? mesesEntre(mesInicio, mesFim).filter(m => faturaDoMes(m) <= ultimaImportada)
    : undefined

  if (nMeses > 1 || (mesesDoIntervalo && mesesDoIntervalo.length > 1)) {
    // O total acima soma vários meses. Sem este aviso o modelo tende a
    // apresentá-lo como se fosse de um mês só.
    linhas.push(`ATENÇÃO: este total soma ${Math.max(nMeses, mesesDoIntervalo?.length ?? 0)} meses. Para falar de um mês, use o valor da linha abaixo.`)
    linhas.push(`Por mês: ${linhasPorMes(encontradas, mesAppDaTransacao, t => t.valor)}`)
    const estat = estatisticasMensais(encontradas, mesAppDaTransacao, t => t.valor, mesesDoIntervalo)
    if (estat) linhas.push(estat)
  }

  // A quebra por cartão é obrigatória quando há mais de um: o Dashboard mostra
  // "Fatura NuBank" isolada, então um total somando todos os cartões não bate
  // com o número que o usuário tem na tela.
  const cartoesPresentes = new Set(encontradas.map(t => t.cartao ?? 'nubank'))
  if (cartoesPresentes.size > 1) {
    const mapa = agrupar(encontradas, t => nomeCartao(t.cartao, labels), t => t.valor)
    linhas.push(`Por cartão (o card "Fatura NuBank" do app mostra SÓ a linha do Nubank): ${linhasAgrupamento(mapa, total)}`)
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
  if (grupo === 'descricao' || (!grupo && busca && encontradas.length > 3)) {
    // Agrupa pelo nome limpo: "PG *LOJA 123" e "LOJA" viram a mesma loja.
    const mapa = agrupar(encontradas, t => limparDescricao(t.descricao).slice(0, 32), t => t.valor)
    linhas.push(`Por estabelecimento: ${linhasAgrupamento(mapa, total)}`)
  }

  const limite = Math.min(Math.max(Number(f.limite) || MAX_ITENS_LISTA, 1), MAX_ITENS_LISTA)
  const paginas = Math.max(1, Math.ceil(encontradas.length / limite))
  const pagina = Math.min(Math.max(Math.round(Number(f.pagina) || 1), 1), paginas)
  const porData = f.ordenarPor === 'data'
  const ordenadas = [...encontradas].sort(porData
    ? (a, b) => (b.data ?? '').localeCompare(a.data ?? '') || b.valor - a.valor
    : (a, b) => b.valor - a.valor)
  const itens = ordenadas.slice((pagina - 1) * limite, pagina * limite)
  linhas.push(
    `${porData ? 'Lançamentos mais recentes' : 'Maiores lançamentos'} ` +
    `(${(pagina - 1) * limite + 1}–${(pagina - 1) * limite + itens.length} de ${encontradas.length}):`
  )
  for (const t of itens) {
    const parc = t.total_parcelas && t.total_parcelas > 1 ? ` [${t.parcela_atual}/${t.total_parcelas}]` : ''
    linhas.push(
      `  • ${t.descricao.slice(0, 38)}${parc} — ${R(t.valor)} — ${fmtData(t.data)} — ` +
      `${t.responsavel || '—'} — ${nomeCartao(t.cartao, labels)} — ${t.categoria ?? 'sem categoria'} — mês ${fmtMes(mesAppDaTransacao(t))}`
    )
  }
  if (paginas > 1) {
    linhas.push(
      `LISTA PARCIAL: página ${pagina} de ${paginas}. Ao listar para o usuário, diga que são ${itens.length} de ${encontradas.length} ` +
      `ou peça a próxima página (pagina=${pagina + 1 <= paginas ? pagina + 1 : paginas}). Os totais acima já consideram todos.`
    )
  }

  if (encontradas.some(t => mesEfetivo(t) === refs.faturaEmFormacao)) {
    linhas.push(`Obs.: a fatura de ${fmtMes(refs.mesApp)} ainda está em formação (hoje é dia ${refs.diaAtual}) — o valor ainda vai subir.`)
  }
  if (avisoFuturo) linhas.push(avisoFuturo)
  if (f.apenasParceladas === true) {
    linhas.push('Para a evolução mês a mês das parcelas (quanto reduz, quando cada compra termina), use projetar_parcelamentos.')
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

const estaPaga = (p: Planejamento) => Boolean(p.data_pagamento || p.pago)

/**
 * Valor que conta para a conta: o pago de fato (valor_real) quando a conta já
 * foi paga, senão o previsto — a mesma regra da tela de Finanças. Usar sempre o
 * previsto fazia "a luz custou R$ 200" quando o pagamento registrado foi R$ 237.
 */
export const valorEfetivo = (p: Planejamento) =>
  estaPaga(p) ? Number(p.valor_real ?? p.valor_previsto ?? 0) : Number(p.valor_previsto ?? 0)

export function consultarPlanejamento(data: EnrichedData, f: FiltroPlanejamento, refs: Referencias): string {
  const busca = typeof f.busca === 'string' && f.busca.trim() ? f.busca.trim() : undefined
  const categoria = resolverCategoria(f.categoria, data)
  const responsavel = resolverResponsavel(f.responsavel, data)
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)
  const status: StatusPlanejamento =
    f.status && ['todos', 'pago', 'aberto', 'vencido'].includes(f.status) ? f.status : 'todos'

  const filtros = descreverFiltros([
    busca && `item contém "${busca}"`,
    categoria && `categoria=${categoria}`,
    responsavel && `responsável=${responsavel}`,
    mesInicio && mesFim && mesInicio === mesFim && `mês ${fmtMes(mesInicio)}`,
    mesInicio && (!mesFim || mesInicio !== mesFim) && `a partir de ${fmtMes(mesInicio)}`,
    mesFim && (!mesInicio || mesInicio !== mesFim) && `até ${fmtMes(mesFim)}`,
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
    if (busca && !casaBusca(p.item ?? '', busca)) return false
    const pago = estaPaga(p)
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
      linhaSugestoes(data.planejamento.filter(ehDespesaPlanejada).map(p => p.item ?? ''), busca),
    ].filter(Boolean).join('\n')
  }

  const previsto = encontradas.reduce((s, p) => s + p.valor_previsto, 0)
  const efetivo = encontradas.reduce((s, p) => s + valorEfetivo(p), 0)
  const pagas = encontradas.filter(estaPaga)
  const totalPago = pagas.reduce((s, p) => s + valorEfetivo(p), 0)
  const emAberto = encontradas.filter(p => !estaPaga(p)).reduce((s, p) => s + p.valor_previsto, 0)

  const linhas: string[] = [
    cabecalho,
    `Total: ${R(efetivo)} em ${encontradas.length} item(ns) (pagas pelo valor pago, abertas pelo previsto) · ` +
    `pago ${R(totalPago)} · em aberto ${R(emAberto)}` +
    (Math.abs(efetivo - previsto) >= 0.01 ? ` · orçamento original ${R(previsto)} (diferença ${R(efetivo - previsto)})` : ''),
  ]

  if (contarMeses(encontradas, mesDe) > 1) {
    linhas.push(`Por mês de referência: ${linhasPorMes(encontradas, mesDe, valorEfetivo)}`)
    const estat = estatisticasMensais(encontradas, mesDe, valorEfetivo, mesInicio && mesFim ? mesesEntre(mesInicio, mesFim) : undefined)
    if (estat) linhas.push(estat)
  }

  const grupo = f.agruparPor
  if (grupo === 'categoria' || (!grupo && !categoria && encontradas.length > 3)) {
    const mapa = agrupar(encontradas, p => p.categoria ?? 'Sem categoria', valorEfetivo)
    linhas.push(`Por categoria: ${linhasAgrupamento(mapa, efetivo)}`)
  }
  if (grupo === 'responsavel') {
    const mapa = agrupar(encontradas, p => p.responsavel ?? 'Compartilhado', valorEfetivo)
    linhas.push(`Por responsável: ${linhasAgrupamento(mapa, efetivo)}`)
  }
  if (grupo === 'descricao') {
    const mapa = agrupar(encontradas, p => (p.item ?? '').slice(0, 32), valorEfetivo)
    linhas.push(`Por item: ${linhasAgrupamento(mapa, efetivo)}`)
  }
  if (grupo === 'cartao') {
    linhas.push('Obs.: contas fixas não têm cartão — agrupamento por cartão não se aplica aqui.')
  }

  const limite = Math.min(Math.max(Number(f.limite) || MAX_ITENS_LISTA, 1), MAX_ITENS_LISTA)
  const itens = [...encontradas].sort((a, b) => valorEfetivo(b) - valorEfetivo(a)).slice(0, limite)
  linhas.push(`Itens (top ${itens.length} de ${encontradas.length}${itens.length < encontradas.length ? ' — LISTA PARCIAL' : ''}):`)
  for (const p of itens) {
    const venc = (p.data_vencimento ?? '').substring(0, 10)
    const pago = estaPaga(p)
    const atrasado = !pago && venc && venc < hojeIso
    const venceHoje = !pago && venc === hojeIso
    const estado = pago
      ? `pago${p.data_pagamento ? ` em ${fmtData(p.data_pagamento)}` : ''}${p.valor_real != null && Math.abs(p.valor_real - p.valor_previsto) >= 0.01 ? ` (${R(p.valor_real)}, previsto ${R(p.valor_previsto)})` : ''}`
      : atrasado ? '⚠️ VENCIDO' : venceHoje ? 'vence HOJE' : 'em aberto'
    const parc = p.total_parcelas && p.total_parcelas > 1 ? ` [${p.parcela_atual}/${p.total_parcelas}]` : ''
    linhas.push(
      `  • ${(p.item ?? '').slice(0, 38)}${parc} — ${R(valorEfetivo(p))} — ${fmtMes(mesDe(p))} — ` +
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
  status?: 'todos' | 'recebido' | 'aberto' | 'parcial'
}

/**
 * Quanto já entrou de uma receita — a mesma regra da tela de Receitas: soma
 * dos recebimentos registrados (que podem ser parciais); sem eles, o legado
 * pago/valor_real. Antes só o flag `pago` contava, então um salário recebido
 * pela metade aparecia como "nada recebido".
 */
function recebidoDe(p: Planejamento, recebimentos: Map<string, number>): number {
  const registrado = p.id ? recebimentos.get(p.id) : undefined
  if (registrado !== undefined) return registrado
  return p.pago ? Number(p.valor_real ?? p.valor_previsto ?? 0) : 0
}

function mapaRecebimentos(data: EnrichedData): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const r of data.recebimentos ?? []) {
    mapa.set(r.planejamento_id, (mapa.get(r.planejamento_id) ?? 0) + Number(r.valor ?? 0))
  }
  return mapa
}

export function consultarReceitas(data: EnrichedData, f: FiltroReceitas, refs: Referencias): string {
  const mesInicio = normalizarMes(f.mesInicio)
  const mesFim = normalizarMes(f.mesFim)
  const responsavel = resolverResponsavel(f.responsavel, data)
  const status = f.status && ['todos', 'recebido', 'aberto', 'parcial'].includes(f.status) ? f.status : 'todos'
  const recebimentos = mapaRecebimentos(data)

  const filtros = descreverFiltros([
    mesInicio && mesFim && mesInicio === mesFim && `mês ${fmtMes(mesInicio)}`,
    mesInicio && (!mesFim || mesInicio !== mesFim) && `a partir de ${fmtMes(mesInicio)}`,
    mesFim && (!mesInicio || mesInicio !== mesFim) && `até ${fmtMes(mesFim)}`,
    responsavel && `responsável=${responsavel}`,
    status !== 'todos' && `status=${status}`,
  ])

  const situacao = (p: Planejamento): 'recebido' | 'parcial' | 'aberto' => {
    const r = recebidoDe(p, recebimentos)
    if (r <= 0) return 'aberto'
    return r >= p.valor_previsto - 0.005 ? 'recebido' : 'parcial'
  }

  const encontradas = data.planejamento.filter(p => {
    if (!(p.item ?? '').startsWith(RECEITA_PREFIXO)) return false
    const m = mesDe(p)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    if (responsavel && p.responsavel !== responsavel) return false
    const sit = situacao(p)
    if (status === 'recebido' && sit !== 'recebido') return false
    // "aberto" = ainda falta receber algo (inclui parciais).
    if (status === 'aberto' && sit === 'recebido') return false
    if (status === 'parcial' && sit !== 'parcial') return false
    return true
  })

  const cabecalho = `CONSULTA: receitas / entradas (${filtros})`
  if (encontradas.length === 0) {
    return [cabecalho, 'Resultado: nenhuma receita cadastrada com esses filtros.'].join('\n')
  }

  const nome = (p: Planejamento) => (p.item ?? '').replace(RECEITA_PREFIXO, '')
  const previsto = encontradas.reduce((s, p) => s + p.valor_previsto, 0)
  const recebido = encontradas.reduce((s, p) => s + recebidoDe(p, recebimentos), 0)

  const linhas: string[] = [
    cabecalho,
    `Previsto: ${R(previsto)} em ${encontradas.length} lançamento(s) · já recebido ${R(recebido)} · a receber ${R(Math.max(previsto - recebido, 0))}`,
  ]

  if (contarMeses(encontradas, mesDe) > 1) {
    linhas.push(`Por mês (previsto): ${linhasPorMes(encontradas, mesDe, p => p.valor_previsto)}`)
    linhas.push(`Por mês (recebido): ${linhasPorMes(encontradas, mesDe, p => recebidoDe(p, recebimentos))}`)
    const estat = estatisticasMensais(encontradas, mesDe, p => p.valor_previsto)
    if (estat) linhas.push(`${estat} (previsto)`)
  }

  const itens = [...encontradas]
    .sort((a, b) => mesDe(b).localeCompare(mesDe(a)) || b.valor_previsto - a.valor_previsto)
    .slice(0, MAX_ITENS_LISTA)
  linhas.push(`Lançamentos (${itens.length} de ${encontradas.length}):`)
  for (const p of itens) {
    const r = recebidoDe(p, recebimentos)
    const sit = situacao(p)
    const estado = sit === 'recebido' ? `recebido ${R(r)}` : sit === 'parcial' ? `PARCIAL: recebido ${R(r)}, faltam ${R(p.valor_previsto - r)}` : 'a receber'
    linhas.push(`  • ${nome(p).slice(0, 38)} — previsto ${R(p.valor_previsto)} — ${fmtMes(mesDe(p))} — ${estado} — ${p.responsavel ?? 'compartilhado'}`)
  }
  linhas.push(`Referência: o mês corrente é ${fmtMes(refs.mesApp)}.`)

  return linhas.join('\n')
}

// ─── 4. Assinaturas ──────────────────────────────────────────────────────────

export interface FiltroAssinaturas {
  busca?: string
  status?: 'ativas' | 'pausadas' | 'canceladas' | 'todas'
  categoria?: string
  responsavel?: string
  cartao?: string
}

/** Pausada = inativa com data de retorno marcada; cancelada = inativa sem retorno. */
const estaPausada = (a: { ativa: boolean; pausada_ate?: string | null }) => !a.ativa && Boolean(a.pausada_ate)

export function consultarAssinaturas(data: EnrichedData, f: FiltroAssinaturas): string {
  const busca = typeof f.busca === 'string' && f.busca.trim() ? f.busca.trim() : undefined
  const status = f.status && ['ativas', 'pausadas', 'canceladas', 'todas'].includes(f.status) ? f.status : 'ativas'
  const categoria = resolverCategoria(f.categoria, data)
  const responsavel = resolverResponsavel(f.responsavel, data)
  const cartao = resolverCartao(f.cartao, data)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const filtros = descreverFiltros([
    busca && `nome contém "${busca}"`,
    `status=${status}`,
    categoria && `categoria=${categoria}`,
    responsavel && `responsável=${responsavel}`,
    cartao && `cartão=${nomeCartao(cartao, labels)}`,
  ])

  const encontradas = data.assinaturas.filter(a => {
    if (status === 'ativas' && !a.ativa) return false
    if (status === 'pausadas' && !estaPausada(a)) return false
    if (status === 'canceladas' && (a.ativa || estaPausada(a))) return false
    if (categoria && a.categoria !== categoria) return false
    if (responsavel && normalizar(a.responsavel) !== normalizar(responsavel)) return false
    if (cartao && (a.cartao ?? 'nubank') !== cartao) return false
    if (busca && !casaBusca(a.nome, busca)) return false
    return true
  })

  const cabecalho = `CONSULTA: assinaturas (${filtros})`
  const pausadas = data.assinaturas.filter(estaPausada)
  const notaPausadas = status === 'ativas' && pausadas.length > 0
    ? `Há ${pausadas.length} assinatura(s) PAUSADA(S) fora desta lista, que voltam a cobrar sozinhas: ` +
      pausadas.map(a => `${a.nome} ${R(a.valor)} (volta em ${fmtData(a.pausada_ate)})`).join(' · ')
    : null

  if (encontradas.length === 0) {
    return [
      cabecalho,
      'Resultado: nenhuma assinatura encontrada com esses filtros.',
      linhaSugestoes(data.assinaturas.map(a => a.nome), busca),
      notaPausadas,
    ].filter(Boolean).join('\n')
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
    const estado = a.ativa ? 'ativa' : estaPausada(a) ? `pausada até ${fmtData(a.pausada_ate)}` : 'cancelada'
    linhas.push(
      `  • ${a.nome.slice(0, 32)} — ${R(a.valor)}/mês — ${a.categoria || 'Outros'} — ` +
      `${nomeCartao(a.cartao, labels)} — ${a.responsavel || 'compartilhado'} — ` +
      `${estado}${a.dia_cobranca ? ` — cobra dia ${a.dia_cobranca}` : ''}`
    )
  }
  if (notaPausadas) linhas.push(notaPausadas)

  return linhas.join('\n')
}

// ─── 5. Investimentos ────────────────────────────────────────────────────────

export interface FiltroInvestimentos {
  mesInicio?: string
  mesFim?: string
}

/**
 * Saldo mais recente informado para cada investimento (pelo nome), a partir do
 * campo "saldo atual" que o usuário preenche ao registrar um aporte. É o único
 * dado de patrimônio que o app tem — não há integração com corretora.
 */
function saldosInformados(data: EnrichedData): Array<{ nome: string; saldo: number; data: string }> {
  const nomePorId = new Map(data.investimentos.map(i => [i.id, i.descricao]))
  const porNome = new Map<string, { nome: string; saldo: number; data: string }>()
  for (const a of data.aportes) {
    if (a.saldo_atual === null || a.saldo_atual === undefined) continue
    const nome = nomePorId.get(a.investimento_id) ?? 'Investimento'
    const chave = normalizar(nome)
    const atual = porNome.get(chave)
    if (!atual || (a.data_aporte ?? '') > atual.data) porNome.set(chave, { nome, saldo: Number(a.saldo_atual), data: a.data_aporte ?? '' })
  }
  return [...porNome.values()].sort((a, b) => b.saldo - a.saldo)
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

  linhas.push(`Aportes no recorte: ${R(totalAportado)} em ${aportes.length} depósito(s) · total histórico registrado: ${R(totalHistorico)} em ${data.aportes.length} aporte(s)`)

  const saldos = saldosInformados(data)
  if (saldos.length > 0) {
    const soma = saldos.reduce((s, x) => s + x.saldo, 0)
    linhas.push(
      `Saldo informado pelo usuário (último "saldo atual" de cada investimento): ${R(soma)} → ` +
      saldos.map(x => `${x.nome} ${R(x.saldo)} (em ${fmtData(x.data)})`).join(' · ') +
      '. É o valor digitado no app, não cotação em tempo real — diga a data.'
    )
  } else {
    linhas.push('Nenhum saldo atual foi informado nos aportes: o app só sabe quanto foi APORTADO, não quanto a carteira vale hoje nem quanto rendeu.')
  }

  if (aportes.length > 0) {
    linhas.push(`Por mês: ${linhasPorMes(aportes, a => (a.data_aporte ?? '').substring(0, 7), a => a.valor)}`)
    const estat = estatisticasMensais(aportes, a => (a.data_aporte ?? '').substring(0, 7), a => a.valor, mesInicio && mesFim ? mesesEntre(mesInicio, mesFim) : undefined)
    if (estat) linhas.push(estat)

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
    // `percentual` é a fatia da SOBRA do mês que o casal planejou destinar a
    // cada investimento — não é rentabilidade.
    linhas.push(`Planejamento da carteira (% da sobra do mês destinada a cada investimento — NÃO é rendimento): ${carteira.map(i => `${i.descricao} ${i.percentual}% (${fmtMes((i.mes_referencia ?? '').substring(0, 7))})`).join(' · ')}`)
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
  // O mês do app M reúne a fatura de projeto_fatura M+1 com as contas fixas e
  // receitas de mes_referencia M — exatamente o pareamento do Dashboard. Antes
  // isto casava fatura(M) com fixas(M), somando períodos diferentes.
  const txs = data.transacoes.filter(t => mesEfetivo(t) === faturaDoMes(mes))
  const fixas = data.planejamento.filter(p => ehDespesaPlanejada(p) && mesDe(p) === mes)
  const receitas = data.planejamento.filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO) && mesDe(p) === mes)
  const recebimentos = mapaRecebimentos(data)

  return {
    mes,
    faturaTotal: txs.reduce((s, t) => s + t.valor, 0),
    faturaPorCartao: agrupar(txs, t => nomeCartao(t.cartao, labels), t => t.valor),
    // Pagas pelo valor pago, abertas pelo previsto — como a tela de Finanças.
    fixasPrevistas: fixas.reduce((s, p) => s + valorEfetivo(p), 0),
    fixasPagas: fixas.filter(estaPaga).reduce((s, p) => s + valorEfetivo(p), 0),
    receitasPrevistas: receitas.reduce((s, p) => s + p.valor_previsto, 0),
    receitasRecebidas: receitas.reduce((s, p) => s + recebidoDe(p, recebimentos), 0),
    assinaturas: totalAssinaturas,
  }
}

export function resumoMensal(
  data: EnrichedData,
  params: { mesInicio?: string; mesFim?: string },
  refs: Referencias
): string {
  const totalAssinaturas = data.assinaturas.filter(a => a.ativa).reduce((s, a) => s + a.valor, 0)

  const inicio = normalizarMes(params.mesInicio) ?? normalizarMes(params.mesFim) ?? refs.mesApp
  const fim = normalizarMes(params.mesFim) ?? inicio
  const meses = (inicio <= fim ? mesesEntre(inicio, fim) : mesesEntre(fim, inicio)).slice(-12)

  const linhas: string[] = [
    `CONSULTA: resumo consolidado de ${fmtMes(meses[0])} a ${fmtMes(meses[meses.length - 1])}`,
    'Cada linha é um mês do app: a fatura que fecha nesse mês somada às contas fixas e receitas do mesmo mês — o mesmo recorte do Dashboard.',
  ]

  const ultimas = ultimaFaturaPorCartao(data.transacoes)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const saidasPorMes: Array<{ mes: string; saidas: number }> = []

  for (const mes of meses) {
    const r = calcularResumoMes(data, mes, totalAssinaturas)
    const saidas = r.faturaTotal + r.fixasPrevistas
    saidasPorMes.push({ mes, saidas })
    const saldo = r.receitasPrevistas - saidas
    const cartoes = [...r.faturaPorCartao.entries()].map(([c, v]) => `${c} ${R(v.total)}`).join(' + ') || 'sem lançamentos'
    // Fatura ainda não importada: o "cartão" desse mês não é zero, só não chegou.
    const naoImportados = Object.entries(ultimas)
      .filter(([, pf]) => faturaDoMes(mes) > pf)
      .map(([id]) => nomeCartao(id, labels))
    linhas.push(
      `${fmtMes(mes)} — saídas ${R(saidas)} = fatura ${R(r.faturaTotal)} (${cartoes}) + fixas ${R(r.fixasPrevistas)} ` +
      `(pagas ${R(r.fixasPagas)}) | receitas previstas ${R(r.receitasPrevistas)} (recebidas ${R(r.receitasRecebidas)}) | ` +
      `${saldo >= 0 ? 'sobra' : 'déficit'} ${R(Math.abs(saldo))}` +
      (naoImportados.length > 0 ? ` | ⚠️ fatura ainda NÃO importada (${naoImportados.join(', ')}): a parte de cartão está incompleta — use projecao_futura para estimar` : '')
    )
  }

  const estat = estatisticasMensais(saidasPorMes, x => x.mes, x => x.saidas)
  if (estat) linhas.push(`${estat} (saídas)`)

  linhas.push(`Assinaturas ativas (recorrência já embutida nas faturas): ${R(totalAssinaturas)}/mês.`)
  if (meses.includes(refs.mesApp)) {
    linhas.push(`Atenção: a fatura de ${fmtMes(refs.mesApp)} ainda está em formação (hoje é dia ${refs.diaAtual}) — o valor tende a subir até o fechamento.`)
  }

  return linhas.join('\n')
}

// ─── 7. Comparação entre períodos ────────────────────────────────────────────

export interface FiltroComparacao {
  periodoAInicio?: string
  periodoAFim?: string
  periodoBInicio?: string
  periodoBFim?: string
  dimensao?: 'categoria' | 'responsavel' | 'cartao' | 'descricao' | 'total'
  responsavel?: string
  categoria?: string
  cartao?: string
  busca?: string
  incluirContasFixas?: boolean
  mesmoPonto?: boolean
}

export function compararPeriodos(data: EnrichedData, f: FiltroComparacao, refs: Referencias): string {
  const aIni = normalizarMes(f.periodoAInicio) ?? refs.mesApp
  const aFim = normalizarMes(f.periodoAFim) ?? aIni
  const bIni = normalizarMes(f.periodoBInicio) ?? somarMeses(aIni, -1)
  const bFim = normalizarMes(f.periodoBFim) ?? bIni
  const dimensao = f.dimensao && ['categoria', 'responsavel', 'cartao', 'descricao', 'total'].includes(f.dimensao)
    ? f.dimensao
    : 'categoria'
  const responsavel = resolverResponsavel(f.responsavel, data)
  const categoria = resolverCategoria(f.categoria, data)
  const cartao = resolverCartao(f.cartao, data)
  const busca = typeof f.busca === 'string' && f.busca.trim() ? f.busca.trim() : undefined
  const incluirFixas = f.incluirContasFixas === true && !cartao && !busca

  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const noIntervalo = (mes: string, ini: string, fim: string) => mes >= ini && mes <= fim

  // "Até o mesmo ponto": o mês corrente está pela metade; compará-lo com um
  // mês fechado inteiro sempre parece economia. Com mesmoPonto, cada compra do
  // período B só conta se foi feita até o dia equivalente a hoje naquele mês.
  const aTemMesCorrente = noIntervalo(refs.mesApp, aIni, aFim)
  const cortarB = f.mesmoPonto === true && aTemMesCorrente
  const hojeIso = format(refs.hoje, 'yyyy-MM-dd')
  // Quantos meses B está atrás de A: o mês de B que "equivale" ao corrente.
  const deslocamento = diffMeses(aIni, bIni)
  const corteB = format(subMonths(refs.hoje, deslocamento), 'yyyy-MM-dd')
  const mesEquivalenteB = somarMeses(refs.mesApp, -deslocamento)

  const casa = (t: Transacao) =>
    (!responsavel || t.responsavel === responsavel) &&
    (!categoria || (t.categoria ?? '') === categoria) &&
    (!cartao || (t.cartao ?? 'nubank') === cartao) &&
    (!busca || casaBusca(t.descricao, busca))

  // Com o corte, os dois lados usam a mesma régua (data da compra ≤ dia equivalente).
  const txA = data.transacoes.filter(t =>
    casa(t) && noIntervalo(mesAppDaTransacao(t), aIni, aFim) && (!cortarB || (t.data ?? '') <= hojeIso)
  )
  const txB = data.transacoes.filter(t => {
    const m = mesAppDaTransacao(t)
    if (!casa(t) || !noIntervalo(m, bIni, bFim)) return false
    if (!cortarB || m !== mesEquivalenteB) return true
    return (t.data ?? '') <= corteB
  })

  const fixasDe = (ini: string, fim: string) => data.planejamento.filter(p =>
    ehDespesaPlanejada(p) && noIntervalo(mesDe(p), ini, fim) &&
    (!responsavel || p.responsavel === responsavel) &&
    (!categoria || (p.categoria ?? '') === categoria)
  )
  const fixasA = incluirFixas ? fixasDe(aIni, aFim) : []
  const fixasB = incluirFixas ? fixasDe(bIni, bFim) : []

  const totalA = txA.reduce((s, t) => s + t.valor, 0) + fixasA.reduce((s, p) => s + valorEfetivo(p), 0)
  const totalB = txB.reduce((s, t) => s + t.valor, 0) + fixasB.reduce((s, p) => s + valorEfetivo(p), 0)
  const variacao = totalB > 0 ? ((totalA - totalB) / totalB) * 100 : 0

  const rotuloA = aIni === aFim ? fmtMes(aIni) : `${fmtMes(aIni)}–${fmtMes(aFim)}`
  const rotuloB = bIni === bFim ? fmtMes(bIni) : `${fmtMes(bIni)}–${fmtMes(bFim)}`

  const escopo = descreverFiltros([
    responsavel && `responsável=${responsavel}`,
    categoria && `categoria=${categoria}`,
    cartao && `cartão=${nomeCartao(cartao, labels)}`,
    busca && `descrição contém "${busca}"`,
  ])

  const linhas: string[] = [
    `CONSULTA: comparação — A=${rotuloA} vs B=${rotuloB} (dimensão: ${dimensao}; filtros: ${escopo})`,
    incluirFixas
      ? 'Base: cartão + contas fixas (mesma base do "Total do mês" do snapshot).'
      : 'Base: SÓ compras de cartão (sem contas fixas). Para comparar o total do mês, use incluirContasFixas=true.',
    `Total A: ${R(totalA)} | Total B: ${R(totalB)} | Variação: ${R(totalA - totalB)} (${totalB > 0 ? pct(variacao) : 'sem base'})`,
  ]
  if (cortarB) {
    linhas.push(`Comparação "até o mesmo ponto": no período B só entram compras feitas até o dia ${refs.diaAtual} do mês equivalente.`)
  }

  if (dimensao !== 'total') {
    const chave = (t: Transacao) =>
      dimensao === 'categoria' ? (t.categoria ?? 'Sem categoria')
      : dimensao === 'responsavel' ? (t.responsavel || 'Sem responsável')
      : dimensao === 'descricao' ? limparDescricao(t.descricao).slice(0, 32)
      : nomeCartao(t.cartao, labels)

    const mapaA = agrupar(txA, chave, t => t.valor)
    const mapaB = agrupar(txB, chave, t => t.valor)
    if (incluirFixas && dimensao !== 'cartao') {
      const chaveFixa = (p: Planejamento) =>
        dimensao === 'categoria' ? (p.categoria ?? 'Sem categoria')
        : dimensao === 'responsavel' ? (p.responsavel ?? 'Compartilhado')
        : (p.item ?? '').slice(0, 32)
      for (const [mapa, fixas] of [[mapaA, fixasA], [mapaB, fixasB]] as const) {
        for (const p of fixas) {
          const k = chaveFixa(p)
          const atual = mapa.get(k) ?? { total: 0, count: 0 }
          atual.total += valorEfetivo(p)
          atual.count += 1
          mapa.set(k, atual)
        }
      }
    }
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

  if (aTemMesCorrente && !cortarB) {
    linhas.push(`Atenção: ${fmtMes(refs.mesApp)} está em formação (dia ${refs.diaAtual}) e B é um mês fechado — a queda pode ser só o mês incompleto. Para uma comparação justa use mesmoPonto=true.`)
  }

  return linhas.join('\n')
}

// ─── 8. Base comum: faturas importadas, parcelamentos, dono dos cartões ──────

/**
 * projeto_fatura da fatura mais recente IMPORTADA de cada cartão.
 *
 * Depois dela não existe nenhuma linha no banco — o que não quer dizer que o
 * mês será zero. Foi exatamente assim que o agente afirmou que os parcelamentos
 * do Matheus no Nubank "zeravam" em novembro: a fatura de novembro só não tinha
 * sido importada ainda, e a consulta de transações voltou vazia.
 */
export function ultimaFaturaPorCartao(transacoes: Transacao[]): Record<string, string> {
  const maxPorCartao: Record<string, string> = {}
  for (const t of transacoes) {
    const id = t.cartao ?? 'nubank'
    const mes = mesEfetivo(t)
    if (mes && (!maxPorCartao[id] || mes > maxPorCartao[id])) maxPorCartao[id] = mes
  }
  return maxPorCartao
}

/** "Nubank até OUT/26 · PicPay até SET/26" — no vocabulário do app. */
export function descreverUltimasFaturas(data: EnrichedData, cartoes?: string[]): string {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  return Object.entries(ultimaFaturaPorCartao(data.transacoes))
    .filter(([id]) => !cartoes || cartoes.includes(id))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, pf]) => `${nomeCartao(id, labels)} até ${fmtMes(mesDaFatura(pf))}`)
    .join(' · ')
}

/**
 * Dono dos cartões extras — a mesma regra da tela de Parcelamentos: se todas as
 * linhas "[CARTAOx] …" do planejamento têm o mesmo responsável (Matheus ou
 * Jeniffer), os itens desse cartão contam para essa pessoa, qualquer que seja
 * o responsável gravado na compra importada.
 */
export function donoCartoes(data: EnrichedData): Record<string, string | undefined> {
  const dono: Record<string, string | undefined> = {}
  for (const id of ['cartao1', 'cartao2'] as const) {
    const unicos = [...new Set(
      data.planejamento.filter(p => tipoCartaoPorItem(p.item) === id).map(p => p.responsavel).filter(Boolean)
    )]
    dono[id] = unicos.length === 1 && (unicos[0] === 'Matheus' || unicos[0] === 'Jeniffer') ? unicos[0]! : undefined
  }
  return dono
}

/** Diferença em meses entre dois 'YYYY-MM' (a − b). */
function diffMeses(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (ya - yb) * 12 + (ma - mb)
}

/** Um parcelamento reconstruído, com a parcela 1 ancorada no mês do app. */
interface ContratoParcela {
  descricao: string
  valor: number
  responsavel: string
  /** Nome exibido da origem (cartão, ou "Contas fixas"). */
  origem: string
  /** Id do cartão; null para contas parceladas do planejamento sem cartão. */
  cartaoId: string | null
  /** true = veio do planejamento; false = de uma fatura importada. */
  doPlanejamento: boolean
  /** Mês do app em que caiu a parcela 1. */
  mesPrimeira: string
  total: number
}

const parcelaNoMes = (c: ContratoParcela, mes: string) => diffMeses(mes, c.mesPrimeira) + 1
const mesUltimaParcela = (c: ContratoParcela) => somarMeses(c.mesPrimeira, c.total - 1)

interface ItemParcela {
  descricao: string
  valor: number
  responsavel: string
  cartaoId: string | null
  parcela: number
  total: number
  real: boolean
}

interface FiltroBaseParcelas {
  responsavel?: string
  cartao?: string
  busca?: string
  incluirContas: boolean
}

interface BaseParcelas {
  lancadas: Array<{ t: Transacao; p: { atual: number; total: number }; responsavel: string }>
  planejadas: Array<{ pl: Planejamento; p: { atual: number; total: number }; cartaoId: string | null }>
  contratos: ContratoParcela[]
  ultimas: Record<string, string>
  cartoesEscopo: string[]
  dono: Record<string, string | undefined>
}

/**
 * Tudo que é parcela, no mesmo recorte da tela de Parcelamentos:
 *  - compras parceladas das faturas importadas (todos os cartões), com os itens
 *    dos cartões extras atribuídos ao dono do cartão;
 *  - linhas parceladas do planejamento (contas parceladas e "[CARTAOx] …").
 * Contratos (para projetar) saem da fatura mais recente de cada cartão e de
 * todas as linhas parceladas do planejamento.
 */
function montarBaseParcelas(data: EnrichedData, f: FiltroBaseParcelas): BaseParcelas {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const dono = donoCartoes(data)
  const ultimas = ultimaFaturaPorCartao(data.transacoes)
  const cartoesEscopo = f.cartao ? [f.cartao] : Object.keys(ultimas).sort()
  const respDaCompra = (t: Transacao) => {
    const id = t.cartao ?? 'nubank'
    return (id !== 'nubank' && dono[id]) || t.responsavel || '—'
  }
  const casa = (desc: string, resp: string | null | undefined) =>
    (!f.responsavel || resp === f.responsavel) && (!f.busca || casaBusca(desc, f.busca))

  const lancadas = data.transacoes
    .map(t => ({ t, p: extrairParcelamento(t as unknown as TransacaoRowParcelamento), responsavel: respDaCompra(t) }))
    .filter(({ t, p, responsavel }) =>
      p !== null && p.total >= 2 &&
      cartoesEscopo.includes(t.cartao ?? 'nubank') &&
      casa(t.descricao, responsavel)
    ) as BaseParcelas['lancadas']

  const planejadas = data.planejamento
    .filter(pl => !(pl.item ?? '').startsWith(RECEITA_PREFIXO) && tipoCartaoPorItem(pl.item) !== 'principal')
    .map(pl => {
      const tipo = tipoCartaoPorItem(pl.item)
      const cartaoId = tipo === 'cartao1' || tipo === 'cartao2' ? tipo : null
      return { pl, p: extrairParcelamento({ ...pl, descricao: pl.item } as unknown as PlanejamentoRowParcelamento), cartaoId }
    })
    .filter(({ pl, p, cartaoId }) =>
      p !== null && p.total >= 2 &&
      (f.cartao ? cartaoId === f.cartao : (cartaoId !== null || f.incluirContas)) &&
      casa(pl.item ?? '', pl.responsavel)
    ) as BaseParcelas['planejadas']

  const contratos: ContratoParcela[] = []
  const snapshot = lancadas.filter(({ t }) => mesEfetivo(t) === ultimas[t.cartao ?? 'nubank'])
  const respPorLinha = new Map(snapshot.map(({ t, responsavel }) => [t, responsavel]))
  for (const { row, parcela } of buildContracts(snapshot.map(({ t }) => t) as unknown as TransacaoRowParcelamento[]).values()) {
    const t = row as unknown as Transacao
    contratos.push({
      descricao: t.descricao,
      valor: Number(t.valor ?? 0),
      responsavel: respPorLinha.get(t) ?? t.responsavel ?? '—',
      origem: nomeCartao(t.cartao, labels),
      cartaoId: t.cartao ?? 'nubank',
      doPlanejamento: false,
      mesPrimeira: somarMeses(mesAppDaTransacao(t), -(parcela.atual - 1)),
      total: parcela.total,
    })
  }
  const cartaoDoItem = new Map(planejadas.map(({ pl, cartaoId }) => [pl, cartaoId]))
  for (const { row, parcela } of buildContratosExtras(planejadas.map(({ pl }) => pl) as unknown as PlanejamentoRowParcelamento[]).values()) {
    const pl = row as unknown as Planejamento
    const cartaoId = cartaoDoItem.get(pl) ?? null
    contratos.push({
      descricao: removerPrefixoCartao(pl.item),
      valor: Number(pl.valor_previsto ?? 0),
      responsavel: pl.responsavel || 'compartilhado',
      origem: cartaoId ? `${nomeCartao(cartaoId, labels)} (planejamento)` : 'Contas fixas',
      cartaoId,
      doPlanejamento: true,
      mesPrimeira: somarMeses(mesDe(pl), -(parcela.atual - 1)),
      total: parcela.total,
    })
  }

  return { lancadas, planejadas, contratos, ultimas, cartoesEscopo, dono }
}

/**
 * Parcelas que caem no mês do app `mes`: reais onde já há registro (fatura
 * importada; planejamento até o mês corrente, como a tela), projetadas depois.
 */
function itensParcelaDoMes(base: BaseParcelas, mes: string, refs: Referencias): ItemParcela[] {
  const itens: ItemParcela[] = []
  const fatura = faturaDoMes(mes)

  for (const id of base.cartoesEscopo) {
    if (base.ultimas[id] && fatura <= base.ultimas[id]) {
      for (const { t, p, responsavel } of base.lancadas) {
        if ((t.cartao ?? 'nubank') === id && mesEfetivo(t) === fatura) {
          itens.push({ descricao: t.descricao, valor: t.valor, responsavel, cartaoId: id, parcela: p.atual, total: p.total, real: true })
        }
      }
    } else {
      for (const c of base.contratos) {
        if (c.doPlanejamento || c.cartaoId !== id) continue
        const n = parcelaNoMes(c, mes)
        if (n >= 1 && n <= c.total) itens.push({ descricao: c.descricao, valor: c.valor, responsavel: c.responsavel, cartaoId: id, parcela: n, total: c.total, real: false })
      }
    }
  }

  if (mes <= refs.mesApp) {
    for (const { pl, p, cartaoId } of base.planejadas) {
      if (mesDe(pl) === mes) {
        itens.push({ descricao: removerPrefixoCartao(pl.item), valor: pl.valor_previsto, responsavel: pl.responsavel || 'compartilhado', cartaoId, parcela: p.atual, total: p.total, real: true })
      }
    }
  } else {
    for (const c of base.contratos) {
      if (!c.doPlanejamento) continue
      const n = parcelaNoMes(c, mes)
      if (n >= 1 && n <= c.total) itens.push({ descricao: c.descricao, valor: c.valor, responsavel: c.responsavel, cartaoId: c.cartaoId, parcela: n, total: c.total, real: false })
    }
  }
  return itens
}

/** Limite de parcelamento vigente para a pessoa no mês (herda o último configurado). */
function limiteEfetivo(data: EnrichedData, responsavel: string, mes: string): { valor: number; desde: string } | undefined {
  const candidatos = (data.limites ?? [])
    .filter(l => l.responsavel === responsavel && (l.mes_referencia ?? '').substring(0, 7) <= mes)
    .sort((a, b) => b.mes_referencia.localeCompare(a.mes_referencia))
  const l = candidatos[0]
  return l && l.valor > 0 ? { valor: l.valor, desde: l.mes_referencia.substring(0, 7) } : undefined
}

const textoLimite = (comprometido: number, limite: { valor: number; desde: string }) =>
  comprometido > limite.valor
    ? `limite ${R(limite.valor)} ESTOURADO em ${R(comprometido - limite.valor)}`
    : `limite ${R(limite.valor)}, ainda cabe ${R(limite.valor - comprometido)}`

/**
 * Comprometido × limite por pessoa num mês, no recorte exato da tela de
 * Parcelamentos (todos os cartões + contas parceladas, dono dos cartões extras).
 */
export function limitesDoMes(data: EnrichedData, refs: Referencias, mes: string): string | null {
  if (!data.limites || data.limites.length === 0) return null
  const base = montarBaseParcelas(data, { incluirContas: true })
  const porPessoa = new Map<string, number>()
  for (const i of itensParcelaDoMes(base, mes, refs)) porPessoa.set(i.responsavel, (porPessoa.get(i.responsavel) ?? 0) + i.valor)
  const partes: string[] = []
  for (const pessoa of ['Matheus', 'Jeniffer', 'Conjunto']) {
    const limite = limiteEfetivo(data, pessoa, mes)
    if (!limite) continue
    partes.push(`${pessoa} ${R(porPessoa.get(pessoa) ?? 0)} de ${R(limite.valor)} (${textoLimite(porPessoa.get(pessoa) ?? 0, limite)})`)
  }
  return partes.length > 0 ? `Limites de parcelamento de ${fmtMes(mes)} (comprometido × limite): ${partes.join(' · ')}` : null
}

// ─── 8a. Projeção de compromissos futuros ────────────────────────────────────

/**
 * Contas fixas recorrentes sem metadados de parcelamento (aluguel, internet…)
 * são invisíveis para buildContratosExtras. Detectadas aqui pelo mesmo critério
 * usado para receitas recorrentes: mesmo nome em ≥2 dos últimos 3 meses.
 */
function mediaFixosRecorrentes(planejamento: Planejamento[], mesApp: string): number {
  const semParcela = planejamento.filter(p =>
    ehDespesaPlanejada(p) && !extrairParcelamento({ ...p, descricao: p.item })
  )
  const meses3 = [0, 1, 2].map(i => somarMeses(mesApp, -i))
  const porNome = new Map<string, number[]>()
  for (const p of semParcela) {
    if (!meses3.includes(mesDe(p))) continue
    const nome = p.item ?? ''
    if (!nome) continue
    porNome.set(nome, [...(porNome.get(nome) ?? []), valorEfetivo(p)])
  }
  let total = 0
  for (const valores of porNome.values()) {
    if (valores.length >= 2) total += valores.reduce((s, v) => s + v, 0) / valores.length
  }
  return total
}

/** Média de compras À VISTA por cartão nas últimas 3 faturas fechadas (inclui assinaturas cobradas). */
function mediaAVistaPorCartao(data: EnrichedData, refs: Referencias): Record<string, number> {
  const fechadas = [1, 2, 3].map(i => faturaDoMes(somarMeses(refs.mesApp, -i)))
  const soma: Record<string, number> = {}
  const mesesComDado: Record<string, Set<string>> = {}
  for (const t of data.transacoes) {
    const pf = mesEfetivo(t)
    if (!fechadas.includes(pf)) continue
    const id = t.cartao ?? 'nubank'
    ;(mesesComDado[id] ??= new Set()).add(pf)
    if (t.total_parcelas && t.total_parcelas > 1) continue
    soma[id] = (soma[id] ?? 0) + t.valor
  }
  const media: Record<string, number> = {}
  for (const id of Object.keys(mesesComDado)) media[id] = (soma[id] ?? 0) / mesesComDado[id].size
  return media
}

export interface CompromissosMes {
  mes: string
  total: number
  cartaoReal: number
  cartoesReais: string[]
  parcelasProjetadas: number
  cartoesProjetados: string[]
  fixas: number
  fixasCadastradas: boolean
  assinaturas: number
  /** Compromissos + média de compras à vista nos cartões projetados (sem somar assinaturas de novo). */
  cenarioProvavel: number
  mediaAVista: number
}

/** Compromissos de um mês do app ≥ o corrente: real onde há dado, projetado onde não há. */
export function compromissosDoMes(data: EnrichedData, refs: Referencias, mes: string): CompromissosMes {
  const ultimas = ultimaFaturaPorCartao(data.transacoes)
  const fatura = faturaDoMes(mes)
  const cartoes = Object.keys(ultimas).sort()
  const cartoesReais = cartoes.filter(id => fatura <= ultimas[id])
  const cartoesProjetados = cartoes.filter(id => fatura > ultimas[id])

  const cartaoReal = data.transacoes
    .filter(t => mesEfetivo(t) === fatura && cartoesReais.includes(t.cartao ?? 'nubank'))
    .reduce((s, t) => s + t.valor, 0)

  // Parcelas projetadas dos cartões cuja fatura ainda não chegou — e as
  // parcelas de cartões que só existem no planejamento ("[CARTAOx] …", nunca
  // importados), que de outro modo ficariam de fora.
  const base = montarBaseParcelas(data, { incluirContas: false })
  const parcelasProjetadas = itensParcelaDoMes(base, mes, refs)
    .filter(i => i.cartaoId !== null && (
      (!i.real && cartoesProjetados.includes(i.cartaoId)) || !cartoes.includes(i.cartaoId)
    ))
    .reduce((s, i) => s + i.valor, 0)

  // Contas fixas: as já cadastradas para o mês valem mais que qualquer estimativa.
  // Contas parceladas ainda não lançadas no mês entram pela projeção do contrato.
  const cadastradas = data.planejamento.filter(p => ehDespesaPlanejada(p) && mesDe(p) === mes)
  const nomeBase = (item: string) => normalizar(removerPrefixoCartao(item))
    .replace(/\s*[-–]?\s*parcela\s*\d+\s*\/\s*\d+.*$/, '')
    .replace(/\s+\d{1,2}\/\d{1,2}\s*$/, '')
    .trim()
  const jaLancadas = new Set(cadastradas.map(p => nomeBase(p.item ?? '')))
  let parceladasProjetadas = 0
  const despesas = data.planejamento.filter(p => ehDespesaPlanejada(p))
  for (const { row, parcela } of buildContratosExtras(despesas as unknown as PlanejamentoRowParcelamento[]).values()) {
    // Mês lido da string: new Date('YYYY-MM-01') é meia-noite UTC e cai no mês anterior em fusos negativos.
    const linha = row as unknown as Planejamento
    const n = parcela.atual + diffMeses(mes, mesDe(linha))
    if (n < 1 || n > parcela.total || jaLancadas.has(nomeBase(linha.item ?? ''))) continue
    parceladasProjetadas += Number(linha.valor_previsto ?? 0)
  }
  const fixas = cadastradas.length > 0
    ? cadastradas.reduce((s, p) => s + valorEfetivo(p), 0) + parceladasProjetadas
    : parceladasProjetadas + mediaFixosRecorrentes(data.planejamento, refs.mesApp)

  // Assinaturas só entram nos cartões projetados (nos reais já estão na fatura);
  // as pausadas voltam a contar a partir do mês de retorno.
  const assinaturas = data.assinaturas
    .filter(a => cartoesProjetados.includes(a.cartao ?? 'nubank') || !cartoes.includes(a.cartao ?? 'nubank'))
    .filter(a => a.ativa || (estaPausada(a) && (a.pausada_ate ?? '').substring(0, 7) <= mes))
    .reduce((s, a) => s + a.valor, 0)

  const media = mediaAVistaPorCartao(data, refs)
  const mediaAVista = cartoesProjetados.reduce((s, id) => s + (media[id] ?? 0), 0)

  const total = cartaoReal + parcelasProjetadas + fixas + assinaturas
  return {
    mes,
    total,
    cartaoReal,
    cartoesReais,
    parcelasProjetadas,
    cartoesProjetados,
    fixas,
    fixasCadastradas: cadastradas.length > 0,
    assinaturas,
    cenarioProvavel: cartaoReal + parcelasProjetadas + fixas + Math.max(mediaAVista, assinaturas),
    mediaAVista,
  }
}

export function projecaoFutura(data: EnrichedData, params: { meses?: number }, refs: Referencias): string {
  const nMeses = Math.min(Math.max(Math.round(Number(params.meses) || 6), 1), 12)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const nomes = (ids: string[]) => ids.map(id => nomeCartao(id, labels)).join(', ')

  const linhas: string[] = [
    `CONSULTA: projeção de compromissos — próximos ${nMeses} meses (a partir de ${fmtMes(refs.mesApp)})`,
    `Faturas importadas: ${descreverUltimasFaturas(data)}. Onde a fatura já chegou, o cartão entra pelo valor REAL; depois disso, só as parcelas já contratadas.`,
  ]

  for (let i = 0; i < nMeses; i++) {
    const mes = somarMeses(refs.mesApp, i)
    const c = compromissosDoMes(data, refs, mes)
    const partesCartao: string[] = []
    if (c.cartoesReais.length > 0) partesCartao.push(`fatura real ${R(c.cartaoReal)} (${nomes(c.cartoesReais)})`)
    if (c.cartoesProjetados.length > 0) partesCartao.push(`parcelas projetadas ${R(c.parcelasProjetadas)} (${nomes(c.cartoesProjetados)})`)
    linhas.push(
      `${fmtMes(mes)}: compromissos ${R(c.total)} = ${partesCartao.join(' + ')} + contas fixas ${R(c.fixas)} ` +
      `(${c.fixasCadastradas ? 'já cadastradas no mês' : 'estimadas pela média dos últimos meses'})` +
      (c.assinaturas > 0 ? ` + assinaturas ${R(c.assinaturas)}` : '') +
      (c.cartoesProjetados.length > 0 && c.mediaAVista > 0
        ? ` · cenário provável ${R(c.cenarioProvavel)} (com a média de compras à vista de ${R(c.mediaAVista)}/mês, que já inclui assinaturas)`
        : '') +
      (mes === refs.mesApp ? ' · mês corrente, fatura ainda em formação' : '')
    )
    if (i < 3) {
      const lim = limitesDoMes(data, refs, mes)
      if (lim) linhas.push(`  ${lim}`)
    }
  }

  const receitasFuturas = data.planejamento
    .filter(p => (p.item ?? '').startsWith(RECEITA_PREFIXO) && mesDe(p) >= refs.mesApp)
    .sort((a, b) => mesDe(a).localeCompare(mesDe(b)))
    .slice(0, 10)

  if (receitasFuturas.length > 0) {
    linhas.push(`Receitas já cadastradas: ${receitasFuturas.map(r => `${(r.item ?? '').replace(RECEITA_PREFIXO, '')} ${R(r.valor_previsto)} (${fmtMes(mesDe(r))})`).join(' · ')}`)
  }

  linhas.push('"Compromissos" = só o que já está assumido; o "cenário provável" soma o gasto à vista típico. Deixe claro qual dos dois você está citando.')
  linhas.push('Para a evolução só dos parcelamentos (por pessoa, por cartão, compra a compra e quando cada uma termina), use projetar_parcelamentos.')

  return linhas.join('\n')
}

// ─── 8b. Parcelamentos mês a mês (real + projetado) ──────────────────────────

export interface FiltroParcelamentos {
  responsavel?: string
  cartao?: string
  busca?: string
  mesInicio?: string
  meses?: number
  incluirContas?: boolean
}

/**
 * Evolução dos parcelamentos mês a mês, com a mesma regra da tela de
 * Parcelamentos: nos meses cuja fatura JÁ foi importada vale o que está
 * lançado; depois da última fatura importada de cada cartão, as parcelas são
 * projetadas avançando cada compra parcelada (3/10 → 4/10 → …) até o fim.
 *
 * Existe porque consultar_transacoes só enxerga linhas que existem no banco:
 * perguntado "quanto reduz mês a mês", o agente somou as parcelas lançadas,
 * encontrou R$ 0 no primeiro mês ainda não importado e anunciou uma queda de
 * 100% — e, pedido para conferir, repetiu a mesma consulta e confirmou o erro.
 */
export function projetarParcelamentos(data: EnrichedData, f: FiltroParcelamentos, refs: Referencias): string {
  const responsavel = resolverResponsavel(f.responsavel, data)
  const cartao = resolverCartao(f.cartao, data)
  const busca = typeof f.busca === 'string' && f.busca.trim() ? f.busca.trim() : undefined
  const mesInicio = normalizarMes(f.mesInicio) ?? refs.mesApp
  const nMeses = Math.min(Math.max(Math.round(Number(f.meses) || 6), 1), 24)
  // Padrão igual ao da tela de Parcelamentos: cartões + contas parceladas.
  const incluirContas = cartao ? false : f.incluirContas !== false
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const base = montarBaseParcelas(data, { responsavel, cartao, busca, incluirContas })

  const filtros = descreverFiltros([
    responsavel && `responsável=${responsavel}`,
    cartao && `cartão=${nomeCartao(cartao, labels)}`,
    busca && `descrição contém "${busca}"`,
    incluirContas ? 'cartões + contas parceladas (como a tela de Parcelamentos)' : !cartao && 'só cartões',
  ])

  const cabecalho = `CONSULTA: parcelamentos mês a mês (${filtros})`
  if (cartao && !base.ultimas[cartao] && base.planejadas.length === 0) {
    return [cabecalho, `Resultado: o cartão ${nomeCartao(cartao, labels)} não tem nenhuma fatura importada nem parcela no planejamento.`].join('\n')
  }
  if (base.lancadas.length === 0 && base.contratos.length === 0 && base.planejadas.length === 0) {
    return [
      cabecalho,
      'Resultado: nenhuma compra parcelada encontrada com esses filtros.',
      linhaSugestoes(data.transacoes.filter(t => (t.total_parcelas ?? 0) > 1).map(t => t.descricao), busca),
    ].filter(Boolean).join('\n')
  }

  const meses = Array.from({ length: nMeses }, (_, i) => somarMeses(mesInicio, i))
  const serie = meses.map(mes => {
    const itens = itensParcelaDoMes(base, mes, refs)
    const ultimas = itens.filter(i => i.parcela === i.total)
    return {
      mes,
      total: itens.reduce((s, i) => s + i.valor, 0),
      qtd: itens.length,
      terminam: ultimas.length,
      valorTerminam: ultimas.reduce((s, i) => s + i.valor, 0),
      real: itens.some(i => i.real) || base.cartoesEscopo.some(id => base.ultimas[id] && faturaDoMes(mes) <= base.ultimas[id]),
      projetado: itens.some(i => !i.real) || base.cartoesEscopo.some(id => !base.ultimas[id] || faturaDoMes(mes) > base.ultimas[id]),
    }
  })

  // O limite só é comparável quando o recorte é o mesmo da tela: uma pessoa,
  // todos os cartões e as contas parceladas, sem busca.
  const comparaLimite = Boolean(responsavel) && !cartao && !busca && incluirContas

  const dono = Object.entries(base.dono).filter(([, d]) => d).map(([id, d]) => `${nomeCartao(id, labels)} → ${d}`)
  const linhas: string[] = [
    cabecalho,
    `Faturas importadas: ${descreverUltimasFaturas(data, base.cartoesEscopo) || '—'}. Meses depois disso são PROJETADOS a partir das parcelas já contratadas — não é zero só porque a fatura ainda não chegou.`,
  ]
  if (dono.length > 0) linhas.push(`Como na tela de Parcelamentos, os itens dos cartões extras contam para o dono do cartão: ${dono.join(' · ')}.`)
  linhas.push('Evolução (valor de parcelas em cada mês do app):')

  serie.forEach((l, i) => {
    const fonte = l.real && l.projetado ? 'parte real, parte projetado' : l.real ? 'real' : 'PROJETADO'
    const anterior = i > 0 ? serie[i - 1] : undefined
    const delta = anterior ? l.total - anterior.total : 0
    const variacao = !anterior
      ? ''
      : Math.abs(delta) < 0.005
        ? ' · sem variação vs mês anterior'
        : ` · ${delta < 0 ? 'redução' : 'aumento'} de ${R(Math.abs(delta))}` +
          (anterior.total > 0 ? ` (${pct((delta / anterior.total) * 100)})` : '') + ' vs mês anterior'
    const fim = l.terminam > 0 ? ` · ${l.terminam} compra(s) pagam aqui a ÚLTIMA parcela (${R(l.valorTerminam)} a menos a partir do mês seguinte)` : ''
    const formacao = l.mes === refs.mesApp ? ' · mês corrente, ainda pode crescer' : ''
    const limite = comparaLimite ? limiteEfetivo(data, responsavel!, l.mes) : undefined
    linhas.push(`  ${fmtMes(l.mes)}: ${R(l.total)} em ${l.qtd} parcela(s) — ${fonte}${variacao}${fim}${formacao}${limite ? ` · ${textoLimite(l.total, limite)}` : ''}`)
  })

  if (!responsavel) {
    const lim = limitesDoMes(data, refs, mesInicio)
    if (lim) linhas.push(lim)
  }

  // Contratos que ainda têm parcela a partir do primeiro mês pedido.
  const ativos = base.contratos
    .map(c => ({ c, n: Math.max(parcelaNoMes(c, mesInicio), 1) }))
    .filter(({ c, n }) => n <= c.total)
    .map(({ c, n }) => ({ c, n, restantes: c.total - n + 1, fim: mesUltimaParcela(c) }))
    .sort((a, b) => a.fim.localeCompare(b.fim) || b.c.valor - a.c.valor)

  if (ativos.length > 0) {
    const restante = ativos.reduce((s, a) => s + a.c.valor * a.restantes, 0)
    const ultimoFim = ativos[ativos.length - 1].fim
    linhas.push(`Compras parceladas em aberto a partir de ${fmtMes(mesInicio)}: ${ativos.length} · saldo a pagar ${R(restante)} · a última termina em ${fmtMes(ultimoFim)}.`)
    linhas.push('Compra a compra (ordem de término):')
    for (const { c, n, restantes, fim } of ativos.slice(0, 25)) {
      linhas.push(
        `  • ${c.descricao.slice(0, 38)} — ${R(c.valor)}/mês — parcela ${n}/${c.total} em ${fmtMes(mesInicio)} — ` +
        `última em ${fmtMes(fim)} (faltam ${restantes}, ${R(c.valor * restantes)}) — ${c.responsavel} — ${c.origem}`
      )
    }
    if (ativos.length > 25) linhas.push(`  [+${ativos.length - 25} compras não exibidas — LISTA PARCIAL]`)
  } else {
    linhas.push(`Nenhuma compra parcelada com parcela em ${fmtMes(mesInicio)} ou depois, segundo a última fatura importada.`)
  }

  linhas.push('Escopo: apenas parcelas de compras já feitas. Compras parceladas novas entram por cima destes valores (para testar uma, use simular_compra).')
  return linhas.join('\n')
}

// ─── 8c. Simulação de compra ─────────────────────────────────────────────────

export interface ParametrosSimulacao {
  valorTotal?: number
  valorParcela?: number
  parcelas?: number
  responsavel?: string
  cartao?: string
  mesPrimeiraParcela?: string
  descricao?: string
}

/**
 * "E se eu comprar X em N vezes?" — soma a compra hipotética aos parcelamentos
 * e compromissos já existentes, mês a mês, e compara com o limite da pessoa.
 * Sem isso o modelo fazia a conta de cabeça sobre números de outra consulta.
 */
export function simularCompra(data: EnrichedData, p: ParametrosSimulacao, refs: Referencias): string {
  const parcelas = Math.min(Math.max(Math.round(Number(p.parcelas) || 1), 1), 48)
  const valorParcela = Number.isFinite(p.valorParcela) && Number(p.valorParcela) > 0
    ? Number(p.valorParcela)
    : Number.isFinite(p.valorTotal) && Number(p.valorTotal) > 0 ? Number(p.valorTotal) / parcelas : NaN
  if (!Number.isFinite(valorParcela)) {
    return 'SIMULAÇÃO: informe valorTotal ou valorParcela (maior que zero) e o número de parcelas.'
  }
  const responsavel = resolverResponsavel(p.responsavel, data)
  const cartao = resolverCartao(p.cartao, data)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  // Compra feita hoje entra na fatura em formação = mês corrente do app.
  const inicio = normalizarMes(p.mesPrimeiraParcela) ?? refs.mesApp
  const horizonte = Math.min(parcelas + 1, 12)
  const meses = Array.from({ length: horizonte }, (_, i) => somarMeses(inicio, i))
  const base = montarBaseParcelas(data, { incluirContas: true })

  const linhas: string[] = [
    `SIMULAÇÃO: ${p.descricao ? `"${p.descricao}" ` : ''}${parcelas}× de ${R(valorParcela)} (total ${R(valorParcela * parcelas)})` +
    `${cartao ? ` no ${nomeCartao(cartao, labels)}` : ''}${responsavel ? ` para ${responsavel}` : ''}, 1ª parcela em ${fmtMes(inicio)}, última em ${fmtMes(somarMeses(inicio, parcelas - 1))}.`,
  ]

  for (const mes of meses) {
    const nova = diffMeses(mes, inicio) < parcelas ? valorParcela : 0
    const itens = itensParcelaDoMes(base, mes, refs)
    const daPessoa = responsavel ? itens.filter(i => i.responsavel === responsavel).reduce((s, i) => s + i.valor, 0) : undefined
    const limite = responsavel ? limiteEfetivo(data, responsavel, mes) : undefined
    const comp = mes >= refs.mesApp ? compromissosDoMes(data, refs, mes) : undefined
    const partes: string[] = [`${fmtMes(mes)}: nova parcela ${R(nova)}`]
    if (daPessoa !== undefined) {
      partes.push(`parcelas de ${responsavel} ${R(daPessoa)} → ${R(daPessoa + nova)}${limite ? ` (${textoLimite(daPessoa + nova, limite)})` : ''}`)
    }
    if (comp) partes.push(`compromissos do casal ${R(comp.total)} → ${R(comp.total + nova)}`)
    linhas.push(`  ${partes.join(' · ')}`)
  }

  const receitas = mapaReceitasPorMes(data)
  const primeiraReceita = receitas.get(inicio)
  if (primeiraReceita) {
    const comp = compromissosDoMes(data, refs, inicio)
    linhas.push(`Em ${fmtMes(inicio)}, receitas previstas ${R(primeiraReceita)} − compromissos com a compra ${R(comp.total + valorParcela)} = ${R(primeiraReceita - comp.total - valorParcela)} (sem contar gastos à vista futuros).`)
  }
  linhas.push('Valores projetados consideram só o que já está assumido; gastos à vista do dia a dia vêm por cima.')
  return linhas.join('\n')
}

function mapaReceitasPorMes(data: EnrichedData): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const p of data.planejamento) {
    if (!(p.item ?? '').startsWith(RECEITA_PREFIXO)) continue
    mapa.set(mesDe(p), (mapa.get(mesDe(p)) ?? 0) + p.valor_previsto)
  }
  return mapa
}

// ─── 9. Dimensões disponíveis (grounding) ────────────────────────────────────

export function listarDimensoes(data: EnrichedData, refs: Referencias): string {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const mesesTx = [...new Set(data.transacoes.map(mesAppDaTransacao).filter(Boolean))].sort()
  const mesesPl = [...new Set(data.planejamento.map(mesDe).filter(Boolean))].sort()

  const categoriasUsadas = new Map<string, number>()
  for (const t of data.transacoes) {
    const c = t.categoria ?? 'Sem categoria'
    categoriasUsadas.set(c, (categoriasUsadas.get(c) ?? 0) + 1)
  }
  const cartoesUsados = [...new Set(data.transacoes.map(t => t.cartao ?? 'nubank'))]
  const responsaveis = responsaveisConhecidos(data)

  return [
    'CONSULTA: dimensões disponíveis nos dados (use estes valores exatos nos filtros)',
    `Hoje: ${format(refs.hoje, "dd/MM/yyyy", { locale: ptBR })} · mês corrente ${refs.mesApp}`,
    `Compras de cartão: ${data.transacoes.length} registros, meses de ${mesesTx[0] ?? '—'} a ${mesesTx[mesesTx.length - 1] ?? '—'}`,
    `Planejamento: ${data.planejamento.length} registros, referências de ${mesesPl[0] ?? '—'} a ${mesesPl[mesesPl.length - 1] ?? '—'}`,
    `Categorias com lançamentos: ${[...categoriasUsadas.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(' · ')}`,
    `Categorias válidas no sistema: ${categoriasConhecidas(data).join(' · ')}`,
    `Cartões: ${cartoesUsados.map(id => `${id} = "${nomeCartao(id, labels)}"`).join(' · ')} · última fatura importada: ${descreverUltimasFaturas(data) || '—'}`,
    `Responsáveis: ${responsaveis.join(' · ') || '—'}`,
    `Assinaturas cadastradas: ${data.assinaturas.length} (${data.assinaturas.filter(a => a.ativa).length} ativas, ${data.assinaturas.filter(estaPausada).length} pausadas)`,
    `Investimentos: ${data.investimentos.length} ativo(s), ${data.aportes.length} aporte(s) registrados, ${saldosInformados(data).length} com saldo atual informado`,
    `Limites de parcelamento configurados: ${(data.limites ?? []).length > 0 ? [...new Set((data.limites ?? []).map(l => l.responsavel))].join(', ') : 'nenhum'}`,
    `Listas: ${(data.desejos ?? []).filter(d => !d.realizado).length} desejo(s) em aberto · ${(data.mercado ?? []).filter(m => !m.comprado).length} item(ns) na lista de mercado · ${new Set((data.listasCompras ?? []).map(i => i.lista)).size} lista(s) de compras ativas`,
    ...(data.avisos && data.avisos.length > 0 ? [`Fontes indisponíveis agora: ${data.avisos.join(' ')}`] : []),
  ].join('\n')
}

// ─── 10. Estornos (explicam diferenças de fatura) ────────────────────────────

export function consultarEstornos(data: EnrichedData, params: { mesInicio?: string; mesFim?: string }): string {
  const mesInicio = normalizarMes(params.mesInicio)
  const mesFim = normalizarMes(params.mesFim)
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)

  const encontrados = data.estornos.filter(e => {
    const m = mesDaFatura((e.projeto_fatura ?? '').substring(0, 7))
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
    linhas.push(`  • ${e.descricao.slice(0, 38)} — ${R(Math.abs(e.valor))} — ${fmtData(e.data)} — ${nomeCartao(e.cartao, labels)} — mês ${fmtMes(mesDaFatura((e.projeto_fatura ?? '').substring(0, 7)))} — ${e.status}`)
  }
  return linhas.join('\n')
}

// ─── 11. Listas (desejos, mercado, compras) ──────────────────────────────────

export function consultarListas(data: EnrichedData, params: { tipo?: string; busca?: string }): string {
  const tipo = ['desejos', 'mercado', 'compras', 'todas'].includes(params.tipo ?? '') ? params.tipo! : 'todas'
  const busca = typeof params.busca === 'string' && params.busca.trim() ? params.busca.trim() : undefined
  const casa = (nome: string) => !busca || casaBusca(nome, busca)
  const linhas: string[] = [`CONSULTA: listas (${tipo}${busca ? ` · contém "${busca}"` : ''})`]

  if (tipo === 'desejos' || tipo === 'todas') {
    const todos = (data.desejos ?? []).filter(d => casa(d.nome))
    const abertos = todos.filter(d => !d.realizado)
    const comValor = abertos.filter(d => d.valor_estimado != null)
    const total = comValor.reduce((s, d) => s + Number(d.valor_estimado), 0)
    linhas.push(
      `Lista de desejos: ${abertos.length} em aberto (${todos.length - abertos.length} já realizados) · ` +
      `valor estimado ${R(total)}${comValor.length < abertos.length ? ` (${abertos.length - comValor.length} sem valor informado)` : ''}`
    )
    const ordemPrioridade: Record<string, number> = { alta: 0, media: 1, baixa: 2 }
    for (const d of [...abertos].sort((a, b) => (ordemPrioridade[a.prioridade] ?? 3) - (ordemPrioridade[b.prioridade] ?? 3) || Number(b.valor_estimado ?? 0) - Number(a.valor_estimado ?? 0)).slice(0, MAX_ITENS_LISTA)) {
      linhas.push(`  • ${d.nome.slice(0, 40)} — ${d.valor_estimado != null ? R(Number(d.valor_estimado)) : 'sem valor'} — prioridade ${d.prioridade}${d.criado_por ? ` — de ${d.criado_por}` : ''}`)
    }
  }

  if (tipo === 'mercado' || tipo === 'todas') {
    const pendentes = (data.mercado ?? []).filter(m => !m.comprado && casa(m.nome))
    const total = pendentes.reduce((s, m) => s + Number(m.preco_unit ?? 0) * (m.quantidade || 1), 0)
    const semPreco = pendentes.filter(m => m.preco_unit == null).length
    linhas.push(`Lista de mercado: ${pendentes.length} item(ns) a comprar · estimado ${R(total)}${semPreco ? ` (${semPreco} sem preço)` : ''}`)
    if (pendentes.length > 0) {
      linhas.push(`  ${pendentes.slice(0, 30).map(m => `${m.quantidade > 1 ? `${m.quantidade}× ` : ''}${m.nome}${m.preco_unit != null ? ` (${R(Number(m.preco_unit))})` : ''}`).join(' · ')}`)
    }
  }

  if (tipo === 'compras' || tipo === 'todas') {
    const itens = (data.listasCompras ?? []).filter(i => casa(i.nome) || casa(i.lista))
    const porLista = new Map<string, typeof itens>()
    for (const i of itens) porLista.set(i.lista, [...(porLista.get(i.lista) ?? []), i])
    linhas.push(`Listas de compras ativas: ${porLista.size}`)
    for (const [lista, doLista] of porLista) {
      const pendentes = doLista.filter(i => i.status !== 'comprado')
      const previsto = pendentes.reduce((s, i) => s + Number(i.preco_previsto ?? 0) * (i.quantidade || 1), 0)
      const pago = doLista.filter(i => i.status === 'comprado').reduce((s, i) => s + Number(i.preco_pago ?? i.preco_previsto ?? 0) * (i.quantidade || 1), 0)
      linhas.push(`  • ${lista}: ${pendentes.length} pendente(s) (previsto ${R(previsto)}) · ${doLista.length - pendentes.length} comprado(s) (${R(pago)})` +
        (pendentes.length > 0 ? ` → ${pendentes.slice(0, 12).map(i => i.nome).join(', ')}` : ''))
    }
  }

  return linhas.join('\n')
}

// ─── 12. Calculadora ─────────────────────────────────────────────────────────
// Modelos de linguagem erram conta: somar cinco valores, tirar percentual,
// dividir por meses. Esta ferramenta avalia expressões aritméticas simples com
// um parser próprio (sem eval): números, + − × ÷, potência, parênteses.

function avaliarExpressao(expr: string): number {
  const texto = expr.replace(/R\$/gi, '').replace(/\s+/g, '')
  let pos = 0
  const erro = (msg: string) => new Error(`${msg} em "${expr}"`)

  const numero = (): number => {
    const m = texto.slice(pos).match(/^\d+(?:[.,]\d+)?/)
    if (!m) throw erro('número esperado')
    pos += m[0].length
    return Number(m[0].replace(',', '.'))
  }
  const fator = (): number => {
    const c = texto[pos]
    if (c === '-') { pos++; return -fator() }
    if (c === '+') { pos++; return fator() }
    let valor: number
    if (c === '(') {
      pos++
      valor = soma()
      if (texto[pos] !== ')') throw erro('parêntese não fechado')
      pos++
    } else {
      valor = numero()
    }
    if (texto[pos] === '%') { pos++; valor = valor / 100 }
    if (texto[pos] === '^') { pos++; valor = Math.pow(valor, fator()) }
    return valor
  }
  const produto = (): number => {
    let v = fator()
    while (texto[pos] === '*' || texto[pos] === '/' || texto[pos] === 'x' || texto[pos] === '×' || texto[pos] === '÷') {
      const op = texto[pos++]
      const d = fator()
      if ((op === '/' || op === '÷') && d === 0) throw erro('divisão por zero')
      v = op === '/' || op === '÷' ? v / d : v * d
    }
    return v
  }
  function soma(): number {
    let v = produto()
    while (texto[pos] === '+' || texto[pos] === '-') {
      const op = texto[pos++]
      const d = produto()
      v = op === '+' ? v + d : v - d
    }
    return v
  }

  const resultado = soma()
  if (pos !== texto.length) throw erro(`caractere inesperado "${texto[pos]}"`)
  if (!Number.isFinite(resultado)) throw erro('resultado inválido')
  return resultado
}

export function calcular(params: { expressoes?: unknown }): string {
  const lista = Array.isArray(params.expressoes) ? params.expressoes : typeof params.expressoes === 'string' ? [params.expressoes] : []
  const expressoes = lista.filter((e): e is string => typeof e === 'string' && e.trim().length > 0).slice(0, 20)
  if (expressoes.length === 0) return 'CÁLCULO: nenhuma expressão recebida. Mande, por exemplo, ["redução: 2261.60 - 2180.17", "percentual: (2180.17 - 2261.60) / 2261.60 * 100"].'

  const linhas = ['CÁLCULO (use estes resultados exatamente):']
  for (const bruta of expressoes) {
    const [rotulo, expr] = bruta.includes(':') ? [bruta.slice(0, bruta.indexOf(':')).trim(), bruta.slice(bruta.indexOf(':') + 1)] : ['', bruta]
    try {
      const v = avaliarExpressao(expr)
      linhas.push(`  ${rotulo ? `${rotulo}: ` : ''}${expr.trim()} = ${v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} (${R(v)})`)
    } catch (err) {
      linhas.push(`  ${rotulo ? `${rotulo}: ` : ''}ERRO — ${err instanceof Error ? err.message : 'expressão inválida'}`)
    }
  }
  return linhas.join('\n')
}
