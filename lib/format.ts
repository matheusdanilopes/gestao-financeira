/**
 * Formatadores e coerções numéricas puras.
 *
 * Vive fora de lib/logger.ts de propósito: o logger importa o client do
 * Supabase e lib/notificacoes, então qualquer componente que só precisasse
 * formatar um valor arrastava essas dependências para o bundle.
 *
 * As instâncias de Intl.NumberFormat são criadas uma única vez no módulo.
 * `valor.toLocaleString('pt-BR', { ... })` constrói um formatador novo a cada
 * chamada — caro em listas longas e tooltips de gráfico, que formatam centenas
 * de valores por render.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const BRL_SEM_CENTAVOS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
})

/** "R$ 1.234,56" — sempre com 2 casas. NaN/Infinity viram 0. */
export function formatBRL(value: number): string {
  return BRL.format(Number.isFinite(value) ? value : 0)
}

/**
 * "R$ 1.234" — omite os centavos quando são zero.
 * Usado nos textos enviados à IA, onde a economia de tokens importa.
 */
export function formatBRLCompacto(value: number): string {
  return BRL_SEM_CENTAVOS.format(Number.isFinite(value) ? value : 0)
}

export function numericOnly(value: string): string {
  return value.replace(/[^0-9,.]/g, '')
}

const MOEDA_INPUT = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Máscara de campo em R$: usa só os dígitos digitados, tratando os dois últimos
 * como centavos, e devolve "0,00", "1,23", "1.234,56"… A vírgula vai se
 * deslocando conforme o valor é preenchido. Campo sem dígitos (ou só zeros)
 * vira "", para que apagar com backspace consiga esvaziar o campo.
 */
export function mascaraMoeda(value: string): string {
  const digitos = value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13)
  if (!digitos) return ''
  return MOEDA_INPUT.format(Number(digitos) / 100)
}

/** Número → texto do campo mascarado ("1.234,56"). null/undefined/NaN viram "". */
export function formatarMoedaInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? MOEDA_INPUT.format(n) : ''
}

/** "1.234,56" (texto do campo mascarado) → 1234.56. Vazio/inválido → NaN. */
export function parseMoeda(value: string | null | undefined): number {
  const limpo = String(value ?? '').trim().replace(/\./g, '').replace(',', '.')
  return limpo ? parseFloat(limpo) : NaN
}

/** Converts any value to a finite number, returning fallback (default 0) for NaN/Infinity/null/undefined */
export function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
