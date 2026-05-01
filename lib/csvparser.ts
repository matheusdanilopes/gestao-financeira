import Papa from 'papaparse'
import { createHash } from 'crypto'
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
  responsavel: 'Matheus' | 'Jeniffer'
  projeto_fatura: string
  hash_linha: string
  parcela_atual: number | null
  total_parcelas: number | null
  cartao?: string
}

function parseValorMonetario(valorRaw: number | string | null | undefined): number | null {
  if (typeof valorRaw === 'number') {
    return Number.isFinite(valorRaw) && valorRaw > 0 ? valorRaw : null
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
  if (!Number.isFinite(valor) || valor <= 0) return null
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

function gerarHashLinha(dataISO: string, descricao: string, valor: number): string {
  const valorHash = valor.toFixed(2)
  const descricaoHash = normalizarDescricaoParaHash(descricao)
  const hashString = `${dataISO}|${descricaoHash}|${valorHash}`
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
  cartao: string = 'nubank'
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
    const responsavel: 'Matheus' | 'Jeniffer' =
      descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

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

    // Valor: desconsidera valores negativos (estornos/entradas) e zeros
    const valorRaw = primeiroValorPreenchido(row.amount, row.valor, row.Valor) ?? '0'
    const valor = parseValorMonetario(valorRaw)
    if (valor === null) continue

    // Calcula projeto_fatura com a lógica de ciclo de vencimento
    const dataCompra = new Date(dataISO + 'T12:00:00') // meio-dia para evitar problemas de fuso
    const projetoFatura = calcularProjetoFatura(dataCompra, diaVencimento, ajusteFechamento)

    // Para cartões não-NuBank, inclui o cartao no hash para evitar colisão
    const hashInput = cartao !== 'nubank'
      ? `${dataISO}|${normalizarDescricaoParaHash(descricao)}|${valor.toFixed(2)}|${cartao}`
      : undefined
    const hash_linha = hashInput
      ? createHash('sha256').update(hashInput).digest('hex')
      : gerarHashLinha(dataISO, descricao, valor)

    // Identificação de parcelas no formato X/Y
    let parcela_atual = null
    let total_parcelas = null
    const parcelaMatch = descricao.match(/(\d+)\/(\d+)/)
    if (parcelaMatch) {
      parcela_atual = parseInt(parcelaMatch[1])
      total_parcelas = parseInt(parcelaMatch[2])
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
    })
  }

  return transacoes
}

export function processarTransacoesJSON(
  transacoes: TransacaoInputJSON[],
  diaVencimento: number = 10,
  ajusteFechamento: number = 0
): TransacaoNubank[] {
  function sanitizar(str: string): string {
    return str
      .replace(/\u0000/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
  }

  const result: TransacaoNubank[] = []

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
    const valor = parseValorMonetario(valorRaw)
    if (valor === null) continue

    const responsavel: 'Matheus' | 'Jeniffer' =
      descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

    const dataCompra = new Date(dataISO + 'T12:00:00')
    const projetoFatura = calcularProjetoFatura(dataCompra, diaVencimento, ajusteFechamento)

    const hash_linha = gerarHashLinha(dataISO, descricao, valor)

    let parcela_atual = null
    let total_parcelas = null
    const parcelaMatch = descricao.match(/(\d+)\/(\d+)/)
    if (parcelaMatch) {
      parcela_atual = parseInt(parcelaMatch[1])
      total_parcelas = parseInt(parcelaMatch[2])
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
    })
  }

  return result
}
