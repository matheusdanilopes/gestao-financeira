import { format } from 'date-fns'

/**
 * Calcula o projeto_fatura (mês de cobrança) de uma transação.
 *
 * Regra Nubank: fechamento = vencimento - 7 dias
 * - Se data_compra.dia >= dia_fechamento → vai para a PRÓXIMA fatura
 * - Caso contrário → vai para a FATURA ATUAL
 *
 * Trata corretamente:
 * - Fechamentos com dia negativo (vencimento <= 7): usa o último dia do mês
 * - Meses com 28, 29, 30 ou 31 dias
 * - Ajuste fino de ±1 dia para divergências de fim de semana/feriado
 */
export function calcularProjetoFatura(
  dataCompra: Date,
  diaVencimento: number,
  ajusteFechamento: number = 0
): string {
  const diaCompra = dataCompra.getDate()
  const mes = dataCompra.getMonth()
  const ano = dataCompra.getFullYear()

  const diaFechamento = diaVencimento - 7 + ajusteFechamento

  if (diaFechamento > 0) {
    // Fechamento cai neste mês
    if (diaCompra >= diaFechamento) {
      // Após o corte → próxima fatura (mês seguinte)
      return format(new Date(ano, mes + 1, 1), 'yyyy-MM-dd')
    } else {
      // Antes do corte → fatura atual (este mês)
      return format(new Date(ano, mes, 1), 'yyyy-MM-dd')
    }
  } else {
    // Fechamento <= 0: o corte cai no mês anterior
    // Converte para o dia real do mês atual usando o último dia do mês
    // Ex: vencimento=1 → fechamento=-6 → novembro (30 dias): 30+(-6)=24
    const ultimoDiaMes = new Date(ano, mes + 1, 0).getDate()
    const diaFechamentoReal = ultimoDiaMes + diaFechamento

    if (diaCompra >= diaFechamentoReal) {
      // Após o corte → fatura do mês M+2
      return format(new Date(ano, mes + 2, 1), 'yyyy-MM-dd')
    } else {
      // Antes do corte → fatura do mês M+1
      return format(new Date(ano, mes + 1, 1), 'yyyy-MM-dd')
    }
  }
}

/**
 * Retorna o dia de fechamento exibível para o usuário.
 */
export function descricaoFechamento(
  diaVencimento: number,
  ajusteFechamento: number = 0
): string {
  const diaFechamento = diaVencimento - 7 + ajusteFechamento
  if (diaFechamento > 0) {
    return `Dia ${diaFechamento} de cada mês`
  }
  // Exemplo genérico usando 30 dias como referência
  return `Dia ${30 + diaFechamento} do mês anterior (aprox.)`
}

/**
 * Calcula a data de fechamento esperada para uma fatura específica.
 *
 * Para diaFechamento > 0: o fechamento cai no próprio mês da fatura.
 * Para diaFechamento <= 0: o fechamento cai no mês anterior (calculado com
 * base no último dia desse mês).
 *
 * Exemplo: vencimento=10, ajuste=0 → diaFechamento=3
 *   fatura março/2024 → fecha em 03/03/2024
 *
 * Exemplo: vencimento=1, ajuste=0 → diaFechamento=-6
 *   fatura abril/2024 → fecha em 25/03/2024 (31 dias em março - 6 = 25)
 */
export function calcularDataFechamentoDaFatura(
  mesReferencia: Date,
  diaVencimento: number,
  ajusteFechamento: number = 0
): Date {
  const diaFechamento = diaVencimento - 7 + ajusteFechamento
  const ano = mesReferencia.getFullYear()
  const mes = mesReferencia.getMonth() // 0-indexed

  if (diaFechamento > 0) {
    return new Date(ano, mes, diaFechamento)
  } else {
    // Fechamento cai no mês anterior: usa o último dia do mês anterior
    const ultimoDiaMesAnterior = new Date(ano, mes, 0).getDate()
    const diaReal = ultimoDiaMesAnterior + diaFechamento
    return new Date(ano, mes - 1, diaReal)
  }
}

/**
 * Retorna a data de fechamento no formato 'yyyy-MM-dd'.
 */
export function calcularDataFechamentoDaFaturaISO(
  mesReferencia: Date,
  diaVencimento: number,
  ajusteFechamento: number = 0
): string {
  return format(calcularDataFechamentoDaFatura(mesReferencia, diaVencimento, ajusteFechamento), 'yyyy-MM-dd')
}
