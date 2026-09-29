/**
 * Relógio do assistente no fuso do casal.
 *
 * O servidor roda em UTC: a partir das 21h de Brasília, `new Date()` já é o dia
 * seguinte — e no último dia do mês, o mês seguinte. O agente dizia "hoje é dia
 * 26" às 22h do dia 25 e marcava como VENCIDA a conta que vencia naquele dia.
 */

export const FUSO_USUARIO = 'America/Sao_Paulo'

/**
 * Devolve um Date cujos campos locais (getDate, getMonth, format…) são a hora de
 * parede de São Paulo, qualquer que seja o fuso do servidor. Serve para toda a
 * matemática de calendário do agente; não use para gravar timestamps.
 */
export function agoraBrasil(agora: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_USUARIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const campo = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find(p => p.type === tipo)?.value ?? 0)
  return new Date(campo('year'), campo('month') - 1, campo('day'), campo('hour'), campo('minute'), campo('second'))
}

/**
 * Timestamp do banco (UTC) → 'YYYY-MM-DD HH:mm' na hora de Brasília. Assim
 * "o que foi lançado hoje" compara com a data de parede do casal, não a do
 * servidor.
 */
export function horaLocal(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const l = agoraBrasil(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${l.getFullYear()}-${p(l.getMonth() + 1)}-${p(l.getDate())} ${p(l.getHours())}:${p(l.getMinutes())}`
}
