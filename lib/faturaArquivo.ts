import { TransacaoNubank } from '@/lib/csvparser'

/**
 * Fatura (mes_referencia 'yyyy-MM-01') indicada pelo próprio arquivo exportado.
 *
 * O NuBank nomeia o CSV de cada fatura com a data de vencimento
 * (ex.: "Nubank_2027-01-01.csv" = fatura de janeiro/2027). É a única fonte
 * confiável de em qual fatura cada compra entrou: o NuBank não separa as faturas
 * por uma data de corte fixa (no mesmo dia 23/11, uma compra ficou em dezembro e
 * outra foi para janeiro) e as datas do extrato podem diferir 1 dia das do app.
 *
 * Aceita o nome do arquivo ou um valor explícito ('yyyy-MM' ou 'yyyy-MM-dd').
 */
export function extrairFaturaDoArquivo(nomeOuFatura: string | null | undefined): string | null {
  if (!nomeOuFatura) return null
  const m = nomeOuFatura.match(/(\d{4})-(\d{2})(?:-\d{2})?(?:\.csv)?\s*$/i)
  if (!m) return null
  const ano = Number(m[1])
  const mes = Number(m[2])
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return null
  return `${m[1]}-${m[2]}-01`
}

function diferencaEmMeses(a: string, b: string): number {
  const [anoA, mesA] = a.split('-').map(Number)
  const [anoB, mesB] = b.split('-').map(Number)
  return (anoA - anoB) * 12 + (mesA - mesB)
}

/**
 * Coloca todas as transações do arquivo na fatura indicada por ele.
 *
 * Proteção contra um nome de arquivo que não seja a fatura (ex.: data de
 * exportação): só aplica se a fatura calculada pela fórmula de TODAS as linhas
 * estiver a no máximo 1 mês de distância da fatura do arquivo — que é o que
 * acontece num extrato de fatura de verdade (só as compras da virada mudam de mês).
 *
 * Devolve true quando aplicou. Muda apenas `projeto_fatura` (in-place);
 * data_compra e hash não são tocados.
 */
export function aplicarFaturaDoArquivo(transacoes: TransacaoNubank[], fatura: string | null): boolean {
  if (!fatura || transacoes.length === 0) return false
  const compativel = transacoes.every(t => Math.abs(diferencaEmMeses(t.projeto_fatura, fatura)) <= 1)
  if (!compativel) {
    console.warn(`[faturaArquivo] fatura do arquivo ${fatura} ignorada: linhas fora de ±1 mês da fórmula`)
    return false
  }
  for (const t of transacoes) t.projeto_fatura = fatura
  return true
}
