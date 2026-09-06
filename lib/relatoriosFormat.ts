/**
 * Formatadores compartilhados pelas telas de relatório.
 *
 * Antes cada relatório (página, gerador de PDF e gerador de CSV) carregava a
 * sua própria cópia de `capitalizar` e `formatarMes` — quatro implementações
 * idênticas que já haviam começado a divergir no formato da data.
 */
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "Set/2025" */
export function formatarMes(mes: Date): string {
  return capitalizar(format(mes, 'MMM/yyyy', { locale: ptBR }))
}

/** "Setembro 2025" */
export function formatarMesLongo(mes: Date): string {
  return capitalizar(format(mes, 'MMMM yyyy', { locale: ptBR }))
}

/** "dd/MM/yyyy" a partir de uma data ISO ('2025-09-06' ou com hora). */
export function formatarData(iso: string): string {
  if (!iso) return ''
  const soData = iso.substring(0, 10)
  try {
    return format(new Date(`${soData}T00:00:00`), 'dd/MM/yyyy')
  } catch {
    return iso
  }
}

/** "+12,4%" / "-3,0%" / "—" quando não há base de comparação. */
export function formatarVariacao(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const sinal = pct > 0 ? '+' : ''
  return `${sinal}${pct.toFixed(1).replace('.', ',')}%`
}

/** "45,2%" — percentual simples, sem sinal. */
export function formatarPercentual(pct: number, casas = 1): string {
  if (!Number.isFinite(pct)) return '—'
  return `${pct.toFixed(casas).replace('.', ',')}%`
}

/**
 * Variação percentual entre dois valores. Devolve `null` quando a base é zero —
 * "infinito%" não diz nada ao usuário; a UI mostra "novo" nesse caso.
 */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null
  return ((atual - anterior) / Math.abs(anterior)) * 100
}
