import Papa from 'papaparse'
import { createHash } from 'crypto'
import { format } from 'date-fns'
import { calcularProjetoFatura } from '@/lib/fatura'

type CsvRow = Record<string, string | number | undefined>

export interface TransacaoInputJSON {
  date?: string
  title?: string
  amount?: number | string
  // Nomes alternativos em português
  data?: string
  descricao?: string
  valor?: number | string
}

export interface TransacaoNubank {
  data_compra: string
  descricao: string
  valor: number
  responsavel: 'Matheus' | 'Jeniffer' | 'Conjunto'
  projeto_fatura: string
  hash_linha: string
  parcela_atual: number | null
  total_parcelas: number | null
  cartao?: string
  is_estorno: boolean
  /** Índice de ocorrência dentro do lote importado (1-based). Usado para deduplição;
   *  não é persistido no banco. */
  occurrence_index?: number
}

function parseValorMonetario(valorRaw: number | string | null | undefined): number | null {
  if (typeof valorRaw === 'number') {
    return Number.isFinite(valorRaw) && valorRaw !== 0 ? valorRaw : null
  }

  const valorStr = String(valorRaw ?? '')
    .trim()
    .replace(/[^\d,.-]/g, '')

  if (!valorStr) return null

  const ultimaVirgula = valorStr.lastIndexOf(',')
  const ultimoPonto = valorStr.lastIndexOf('.')

  let normalizado = valorStr

  // Se houver ponto e vírgula, usa o último separador como decimal e remove
  // separadores de milhar do trecho inteiro.
  if (ultimaVirgula !== -1 && ultimoPonto !== -1) {
    const idxDecimal = Math.max(ultimaVirgula, ultimoPonto)
    const parteInteira = valorStr.slice(0, idxDecimal).replace(/[.,]/g, '')
    const parteDecimal = valorStr.slice(idxDecimal + 1).replace(/[.,]/g, '')
    normalizado = `${parteInteira}.${parteDecimal}`
  } else if (ultimaVirgula !== -1) {
    // Só vírgula: trata como separador decimal.
    normalizado = valorStr.replace(/\./g, '').replace(',', '.')
  } else {
    // Só ponto (ou nenhum): remove possíveis vírgulas residuais.
    normalizado = valorStr.replace(/,/g, '')
  }

  const valor = Number(normalizado)
  if (!Number.isFinite(valor) || valor === 0) return null
  return valor
}

function primeiroValorPreenchido(
  ...valores: Array<string | number | null | undefined>
): string | number | undefined {
  for (const valor of valores) {
    if (valor === null || valor === undefined) continue
    if (typeof valor === 'string' && valor.trim() === '') continue
    return valor
  }
  return undefined
}

export function normalizarDescricaoParaHash(descricao: string): string {
  return descricao
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function gerarHashLinha(
  dataISO: string,
  descricao: string,
  valor: number,
  cartao?: string,
  occurrenceIndex: number = 1,
): string {
  const valorHash = valor.toFixed(2)
  const descricaoHash = normalizarDescricaoParaHash(descricao)
  const cartaoSuffix = cartao && cartao !== 'nubank' ? `|${cartao}` : ''
  // Sufixo de ocorrência apenas a partir do segundo registro — assim o hash da
  // primeira ocorrência é idêntico ao formato antigo (retrocompatibilidade total).
  const occurrenceSuffix = occurrenceIndex > 1 ? `|${occurrenceIndex}` : ''
  const hashString = `${dataISO}|${descricaoHash}|${valorHash}${cartaoSuffix}${occurrenceSuffix}`
  return createHash('sha256').update(hashString).digest('hex')
}

function isPagamentoFatura(descricao: string): boolean {
  const lower = descricao.toLowerCase()
  return /^pagamento\b/.test(lower)
}

// Mesmo critério validado usado em app/api/projection/route.ts (extrairParcelamento):
// a regex antiga `/(\d+)\/(\d+)/` não tinha limite de dígitos nem checagem de
// sanidade, então casava qualquer "12/2024" (data) ou código embutido na
// descrição e marcava compras normais como parceladas.
function extrairParcela(descricao: string): { atual: number; total: number } | null {
  const matchParcela = descricao.match(/parcela\s*(\d+)\s*\/\s*(\d+)/i)
  if (matchParcela) {
    const atual = parseInt(matchParcela[1])
    const total = parseInt(matchParcela[2])
    if (atual >= 1 && total >= atual) return { atual, total }
  }
  const matchSlash = descricao.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (matchSlash) {
    const atual = parseInt(matchSlash[1])
    const total = parseInt(matchSlash[2])
    if (atual >= 1 && total >= atual && total >= 2) return { atual, total }
  }
  return null
}

function gerarHashLinhaEstorno(
  dataISO: string,
  descricao: string,
  valor: number,
  cartao?: string,
): string {
  const cartaoSuffix = cartao && cartao !== 'nubank' ? `|${cartao}` : ''
  const hashString = `${dataISO}|${normalizarDescricaoParaHash(descricao)}|${valor.toFixed(2)}${cartaoSuffix}|estorno`
  return createHash('sha256').update(hashString).digest('hex')
}

export function gerarHashLinhaLegado(dataISO: string, descricao: string, valor: number): string {
  const hashString = `${dataISO}|${descricao}|${String(valor)}`
  return createHash('sha256').update(hashString).digest('hex')
}

export function processarCSV(
  csvText: string,
  diaVencimento: number = 10,
  ajusteFechamento: number = 0,
  cartao: string = 'nubank',
  responsavelPadrao?: 'Matheus' | 'Jeniffer' | 'Conjunto'
): TransacaoNubank[] {
  // Remove BOM UTF-8 nos dois formatos possíveis (UTF-8 puro ou lido como Latin-1)
  const csvLimpo = csvText
    .replace(/^\uFEFF/, '')       // BOM como char Unicode
    .replace(/^\u00ef\u00bb\u00bf/, '') // BOM lido como Latin-1 (ï»¿)
    .replace(/\u0000/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  const result = Papa.parse(csvLimpo, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.replace(/^\uFEFF/, '').replace(/^\u00ef\u00bb\u00bf/, '').trim(),
  })
  const transacoes: TransacaoNubank[] = []
  // Rastreia quantas vezes cada combinação (data|desc|valor) aparece no lote,
  // permitindo que dois pedidos idênticos no mesmo dia recebam hashes distintos.
  const occurrenceCounts = new Map<string, number>()

  function sanitizar(str: string): string {
    return str
      .replace(/\u0000/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
  }

  for (const row of result.data as CsvRow[]) {
    // Suporte ao formato novo (date, title, amount) e antigo (Data, Descrição, Valor)
    const descricao = sanitizar(
      String(primeiroValorPreenchido(row.title, row.descricao, row['Descrição'], row.Descricao) ?? '')
    )
    const responsavel: 'Matheus' | 'Jeniffer' | 'Conjunto' =
      responsavelPadrao ??
      (descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus')

    // Data: formato novo YYYY-MM-DD ou antigo DD/MM/YYYY
    const dataRaw = String(primeiroValorPreenchido(row.date, row.data, row.Data) ?? '')
    if (!dataRaw) continue

    let dataISO = ''
    if (/^\d{4}-\d{2}-\d{2}/.test(dataRaw)) {
      dataISO = dataRaw.substring(0, 10)
    } else if (/^\d{2}\/\d{2}\/\d{4}/.test(dataRaw)) {
      const [dia, mes, ano] = dataRaw.split('/')
      dataISO = `${ano}-${mes}-${dia}`
    } else {
      continue
    }

    // Valor: captura positivos (compras) e negativos (estornos); descarta zeros
    const valorRaw = primeiroValorPreenchido(row.amount, row.valor, row.Valor) ?? '0'
    const valorBruto = parseValorMonetario(valorRaw)
    if (valorBruto === null) continue

    const isEstorno = valorBruto < 0
    const valor = parseFloat(Math.abs(valorBruto).toFixed(2))

    // Pagamento de fatura (ex.: "Pagamento recebido") deve ser ignorado
    if (isEstorno && isPagamentoFatura(descricao)) continue

    // Calcula projeto_fatura com a lógica de ciclo de vencimento
    const dataCompra = new Date(dataISO + 'T12:00:00') // meio-dia para evitar problemas de fuso
    let projetoFatura = calcularProjetoFatura(dataCompra, diaVencimento, ajusteFechamento)

    let hash_linha: string
    let parcela_atual: number | null = null
    let total_parcelas: number | null = null
    let occurrenceIndex = 1

    if (isEstorno) {
      hash_linha = gerarHashLinhaEstorno(dataISO, descricao, valor, cartao)
    } else {
      // Conta ocorrências desta combinação dentro do lote para gerar hash único por linha
      const occurrenceKey = `${dataISO}|${normalizarDescricaoParaHash(descricao)}|${valor.toFixed(2)}`
      occurrenceIndex = (occurrenceCounts.get(occurrenceKey) ?? 0) + 1
      occurrenceCounts.set(occurrenceKey, occurrenceIndex)
      hash_linha = gerarHashLinha(dataISO, descricao, valor, cartao, occurrenceIndex)

      // Identificação de parcelas no formato X/Y (apenas para compras normais)
      const parcela = extrairParcela(descricao)
      if (parcela) {
        parcela_atual = parcela.atual
        total_parcelas = parcela.total
      }
    }

    transacoes.push({
      data_compra: dataISO,
      descricao,
      valor,
      responsavel,
      projeto_fatura: projetoFatura,
      hash_linha,
      parcela_atual,
      total_parcelas,
      cartao,
      is_estorno: isEstorno,
      occurrence_index: occurrenceIndex,
    })
  }

  return transacoes
}

export function processarTransacoesJSON(
  transacoes: TransacaoInputJSON[],
  diaVencimento: number = 10,
  ajusteFechamento: number = 0,
  cartao: string = 'nubank'
): TransacaoNubank[] {
  function sanitizar(str: string): string {
    return str
      .replace(/\u0000/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
  }

  const result: TransacaoNubank[] = []
  const occurrenceCounts = new Map<string, number>()

  for (const row of transacoes) {
    const descricao = sanitizar(String(primeiroValorPreenchido(row.title, row.descricao) ?? ''))
    if (!descricao) continue

    const dataRaw = String(primeiroValorPreenchido(row.date, row.data) ?? '')
    if (!dataRaw) continue

    let dataISO = ''
    if (/^\d{4}-\d{2}-\d{2}/.test(dataRaw)) {
      dataISO = dataRaw.substring(0, 10)
    } else if (/^\d{2}\/\d{2}\/\d{4}/.test(dataRaw)) {
      const [dia, mes, ano] = dataRaw.split('/')
      dataISO = `${ano}-${mes}-${dia}`
    } else {
      continue
    }

    const valorRaw = primeiroValorPreenchido(row.amount, row.valor) ?? '0'
    const valorBruto = parseValorMonetario(valorRaw)
    if (valorBruto === null) continue

    const isEstorno = valorBruto < 0
    const valor = parseFloat(Math.abs(valorBruto).toFixed(2))

    if (isEstorno && isPagamentoFatura(descricao)) continue

    const responsavel: 'Matheus' | 'Jeniffer' | 'Conjunto' =
      descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

    const dataCompra = new Date(dataISO + 'T12:00:00')
    let projetoFatura = calcularProjetoFatura(dataCompra, diaVencimento, ajusteFechamento)

    let hash_linha: string
    let parcela_atual: number | null = null
    let total_parcelas: number | null = null
    let occurrenceIndex = 1

    if (isEstorno) {
      hash_linha = gerarHashLinhaEstorno(dataISO, descricao, valor, cartao)
    } else {
      const occurrenceKey = `${dataISO}|${normalizarDescricaoParaHash(descricao)}|${valor.toFixed(2)}`
      occurrenceIndex = (occurrenceCounts.get(occurrenceKey) ?? 0) + 1
      occurrenceCounts.set(occurrenceKey, occurrenceIndex)
      hash_linha = gerarHashLinha(dataISO, descricao, valor, cartao, occurrenceIndex)

      const parcela = extrairParcela(descricao)
      if (parcela) {
        parcela_atual = parcela.atual
        total_parcelas = parcela.total
      }
    }

    result.push({
      data_compra: dataISO,
      descricao,
      valor,
      responsavel,
      projeto_fatura: projetoFatura,
      hash_linha,
      parcela_atual,
      total_parcelas,
      cartao,
      is_estorno: isEstorno,
      occurrence_index: occurrenceIndex,
    })
  }

  return result
}
