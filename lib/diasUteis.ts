import { addDays, addMonths, differenceInCalendarMonths, format, parseISO, startOfMonth } from 'date-fns'

// Feriados nacionais fixos (dia/mês) — Leis 662/1949, 6.802/1980 e 14.759/2023.
const FERIADOS_FIXOS: Array<{ mes: number; dia: number; desde?: number; nome: string }> = [
  { mes: 1,  dia: 1,  nome: 'Confraternização Universal' },
  { mes: 4,  dia: 21, nome: 'Tiradentes' },
  { mes: 5,  dia: 1,  nome: 'Dia do Trabalho' },
  { mes: 9,  dia: 7,  nome: 'Independência do Brasil' },
  { mes: 10, dia: 12, nome: 'Nossa Senhora Aparecida' },
  { mes: 11, dia: 2,  nome: 'Finados' },
  { mes: 11, dia: 15, nome: 'Proclamação da República' },
  { mes: 11, dia: 20, desde: 2024, nome: 'Consciência Negra' },
  { mes: 12, dia: 25, nome: 'Natal' },
]

/** Domingo de Páscoa do ano (algoritmo gregoriano anônimo / Meeus). */
function domingoDePascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const total = h + l - 7 * m + 114
  return new Date(ano, Math.floor(total / 31) - 1, (total % 31) + 1)
}

const cacheFeriados = new Map<number, Set<string>>()

/**
 * Feriados nacionais do ano em 'yyyy-MM-dd'. Além dos feriados fixos e das
 * datas móveis oficiais (Sexta-feira Santa), inclui Carnaval (segunda e terça)
 * e Corpus Christi: não são feriados por lei federal, mas os bancos não operam,
 * então um vencimento que cai neles só pode ser pago no dia útil seguinte.
 */
export function feriadosNacionais(ano: number): Set<string> {
  const emCache = cacheFeriados.get(ano)
  if (emCache) return emCache

  const datas = new Set<string>()
  for (const { mes, dia, desde } of FERIADOS_FIXOS) {
    if (desde && ano < desde) continue
    datas.add(format(new Date(ano, mes - 1, dia), 'yyyy-MM-dd'))
  }

  const pascoa = domingoDePascoa(ano)
  for (const deslocamento of [-48, -47, -2, 60]) {
    datas.add(format(addDays(pascoa, deslocamento), 'yyyy-MM-dd'))
  }

  cacheFeriados.set(ano, datas)
  return datas
}

export function ehFeriadoNacional(data: Date): boolean {
  return feriadosNacionais(data.getFullYear()).has(format(data, 'yyyy-MM-dd'))
}

/** Dia útil bancário: de segunda a sexta e fora dos feriados nacionais. */
export function ehDiaUtil(data: Date): boolean {
  const diaSemana = data.getDay()
  if (diaSemana === 0 || diaSemana === 6) return false
  return !ehFeriadoNacional(data)
}

/** A própria data, se já for dia útil; senão o primeiro dia útil seguinte. */
export function proximoDiaUtil(data: Date): Date {
  // O laço tem no máximo poucos passos (o maior bloqueio possível é uma
  // emenda de feriado com fim de semana), mas o teto evita loop infinito.
  let candidato = data
  for (let i = 0; i < 15 && !ehDiaUtil(candidato); i++) {
    candidato = addDays(candidato, 1)
  }
  return candidato
}

/**
 * Quantos meses o vencimento fica à frente do mês de referência da linha. Uma
 * despesa de setembro pode vencer em 05/10 (deslocamento +1) — é o caso comum
 * das faturas de cartão. Esse deslocamento faz parte da configuração do item e
 * precisa acompanhá-lo ao ser copiado para outro mês: em outubro a mesma conta
 * vence em 05/11, não de novo em 05/10.
 */
export function deslocamentoDoVencimento(
  dataVencimento: string | null | undefined,
  mesReferencia: Date | null | undefined
): number {
  if (!dataVencimento || !mesReferencia) return 0
  try {
    return differenceInCalendarMonths(
      startOfMonth(parseISO(dataVencimento)),
      startOfMonth(mesReferencia)
    )
  } catch {
    return 0
  }
}

/**
 * Mesma data de vencimento para a linha de `novoMes`, preservando o dia
 * (limitado ao último dia do mês de destino) e o deslocamento em relação a
 * `mesReferenciaBase` — o `mes_referencia` da linha de onde a data veio. Sem
 * `mesReferenciaBase` o deslocamento é zero, ou seja, o vencimento cai no
 * próprio `novoMes`. Não considera dia útil — use `ajustarVencimentoParaMes`
 * quando a data precisar ser pagável.
 */
export function moverVencimentoParaMes(
  dataVencimento: string | null | undefined,
  novoMes: Date,
  mesReferenciaBase?: Date | null
): string | null {
  if (!dataVencimento) return null
  try {
    const dia = parseISO(dataVencimento).getDate()
    const destino = addMonths(
      startOfMonth(novoMes),
      deslocamentoDoVencimento(dataVencimento, mesReferenciaBase)
    )
    const ano = destino.getFullYear()
    const mes = destino.getMonth()
    const diasNoMes = new Date(ano, mes + 1, 0).getDate()
    return format(new Date(ano, mes, Math.min(dia, diasNoMes)), 'yyyy-MM-dd')
  } catch {
    return null
  }
}

/**
 * Vencimento da linha de `novoMes`: mesmo dia e mesmo deslocamento em relação a
 * `mesReferenciaBase` (ver `moverVencimentoParaMes`), adiantado para o próximo
 * dia útil quando cai em fim de semana ou feriado nacional. O ajuste é sempre
 * para frente porque antecipar deixaria a conta vencida antes da data
 * combinada; um vencimento no fim do mês pode, por isso, cair no mês seguinte.
 */
export function ajustarVencimentoParaMes(
  dataVencimento: string | null | undefined,
  novoMes: Date,
  mesReferenciaBase?: Date | null
): string | null {
  const movido = moverVencimentoParaMes(dataVencimento, novoMes, mesReferenciaBase)
  if (!movido) return null
  return format(proximoDiaUtil(parseISO(movido)), 'yyyy-MM-dd')
}
