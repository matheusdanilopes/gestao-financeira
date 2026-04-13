import Papa from 'papaparse'
import { createHash } from 'crypto'
import { calcularProjetoFatura } from '@/lib/fatura'

export interface TransacaoNubank {
  data_compra: string
  descricao: string
  valor: number
  responsavel: 'Matheus' | 'Jeniffer'
  projeto_fatura: string
  hash_linha: string
  parcela_atual: number | null
  total_parcelas: number | null
}

export function processarCSV(
  csvText: string,
  diaVencimento: number = 10,
  ajusteFechamento: number = 0
): TransacaoNubank[] {
  // Remove null bytes e caracteres de controle que o PostgreSQL não aceita
  const csvLimpo = csvText.replace(/\u0000/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  const result = Papa.parse(csvLimpo, { header: true, skipEmptyLines: true })
  const transacoes: TransacaoNubank[] = []

  function sanitizar(str: string): string {
    return str
      .replace(/\u0000/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
  }

  for (const row of result.data as any[]) {
    // Suporte ao formato novo (date, title, amount) e antigo (Data, Descrição, Valor)
    const descricao = sanitizar(row.title || row.descricao || row['Descrição'] || row.Descricao || '')
    const responsavel: 'Matheus' | 'Jeniffer' =
      descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

    // Data: formato novo YYYY-MM-DD ou antigo DD/MM/YYYY
    const dataRaw = row.date || row.data || row.Data || ''
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
    const valorRaw = row.amount || row.valor || row.Valor || '0'
    const valorStr = String(valorRaw).replace(',', '.')
    const valor = parseFloat(valorStr)
    if (isNaN(valor) || valor <= 0) continue

    // Calcula projeto_fatura com a lógica de ciclo de vencimento
    const dataCompra = new Date(dataISO + 'T12:00:00') // meio-dia para evitar problemas de fuso
    const projetoFatura = calcularProjetoFatura(dataCompra, diaVencimento, ajusteFechamento)

    const hashString = `${dataISO}|${descricao}|${valorStr}`
    const hash_linha = createHash('sha256').update(hashString).digest('hex')

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
    })
  }

  return transacoes
}
