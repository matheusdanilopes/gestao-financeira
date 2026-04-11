import Papa from 'papaparse'
import { createHash } from 'crypto'

export interface TransacaoNubank {
  data: Date
  descricao: string
  valor: number
  responsavel: 'Matheus' | 'Jeniffer'
  projeto_fatura: Date
  hash_linha: string
  parcela_atual: number | null
  total_parcelas: number | null
}

export function processarCSV(csvText: string): TransacaoNubank[] {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const transacoes: TransacaoNubank[] = []

  for (const row of result.data as any[]) {
    const descricao = row.descricao || row.Descrição || ''
    const responsavel = descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

    const dataStr = row.data || row.Data || ''
    const [dia, mes, ano] = dataStr.split('/')
    const data = new Date(`${ano}-${mes}-${dia}`)

    const valorStr = (row.valor || row.Valor || '0').replace(',', '.')
    const valor = Math.abs(parseFloat(valorStr))

    const projeto_fatura = new Date(data.getFullYear(), data.getMonth(), 1)

    const hashString = `${dataStr}|${descricao}|${valorStr}`
    const hash_linha = createHash('sha256').update(hashString).digest('hex')

    // Identificação de parcelas
    let parcela_atual = null
    let total_parcelas = null
    const parcelaMatch = descricao.match(/(\d+)\/(\d+)/)
    if (parcelaMatch) {
      parcela_atual = parseInt(parcelaMatch[1])
      total_parcelas = parseInt(parcelaMatch[2])
    }

    transacoes.push({
      data,
      descricao,
      valor,
      responsavel,
      projeto_fatura,
      hash_linha,
      parcela_atual,
      total_parcelas
    })
  }
  return transacoes
}
