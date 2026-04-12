import Papa from 'papaparse'
import { createHash } from 'crypto'

export interface TransacaoNubank {
  data: string
  descricao: string
  valor: number
  responsavel: 'Matheus' | 'Jeniffer'
  projeto_fatura: string
  hash_linha: string
  parcela_atual: number | null
  total_parcelas: number | null
}

export function processarCSV(csvText: string): TransacaoNubank[] {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const transacoes: TransacaoNubank[] = []

  for (const row of result.data as any[]) {
    // Suporte ao formato novo (date, title, amount) e antigo (Data, Descrição, Valor)
    const descricao = row.title || row.descricao || row['Descrição'] || row.Descricao || ''
    const responsavel = descricao.toLowerCase().includes('jeniffer') ? 'Jeniffer' : 'Matheus'

    // Data: formato novo YYYY-MM-DD ou antigo DD/MM/YYYY
    let dataISO = ''
    const dataRaw = row.date || row.data || row.Data || ''
    if (!dataRaw) continue

    if (/^\d{4}-\d{2}-\d{2}/.test(dataRaw)) {
      // Já está em formato ISO: YYYY-MM-DD
      dataISO = dataRaw.substring(0, 10)
    } else if (/^\d{2}\/\d{2}\/\d{4}/.test(dataRaw)) {
      // Formato brasileiro: DD/MM/YYYY
      const [dia, mes, ano] = dataRaw.split('/')
      dataISO = `${ano}-${mes}-${dia}`
    } else {
      continue
    }

    // Valor: formato novo é negativo (despesas), antigo usa vírgula
    const valorRaw = row.amount || row.valor || row.Valor || '0'
    const valorStr = String(valorRaw).replace(',', '.')
    const valor = Math.abs(parseFloat(valorStr))
    if (isNaN(valor) || valor === 0) continue

    // projeto_fatura = primeiro dia do mês da transação
    const [ano, mes] = dataISO.split('-')
    const projetoFatura = `${ano}-${mes}-01`

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
      data: dataISO,
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
