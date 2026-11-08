/**
 * Critérios de aprovação de um cenário (separado do runner para ser testável
 * sem modelo nem banco — ver avaliar.test.ts).
 */
import type { AgentEvent } from '../../lib/ai/agent/runAgent'
import type { CasoAvaliacao, Esperado } from './casos'

type Done = Pick<Extract<AgentEvent, { type: 'done' }>, 'texto' | 'trilha' | 'meta'>

const normalizar = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

export function casa(texto: string, e: Esperado): boolean {
  const t = normalizar(texto)
  if (e instanceof RegExp) return e.test(t)
  if (Array.isArray(e)) return e.some(x => casa(texto, x))
  return t.toLowerCase().includes(e.toLowerCase())
}

const rotulo = (e: Esperado) => (e instanceof RegExp ? e.toString() : Array.isArray(e) ? e.join(' | ') : `"${e}"`)

function contem(obj: unknown, parcial: Record<string, unknown>): boolean {
  const o = (obj ?? {}) as Record<string, unknown>
  return Object.entries(parcial).every(([k, v]) => String(o[k] ?? '').toLowerCase() === String(v).toLowerCase())
}

/** Lista do que falhou (vazia = aprovado). */
export function avaliar(caso: CasoAvaliacao, done: Done): string[] {
  const falhas: string[] = []
  const e = caso.espera
  const usadas = done.trilha.map(t => t.nome)

  for (const x of e.contem ?? []) if (!casa(done.texto, x)) falhas.push(`faltou ${rotulo(x)}`)
  for (const x of e.naoContem ?? []) if (casa(done.texto, x)) falhas.push(`não devia conter ${rotulo(x)}`)
  if (e.algumaFerramenta && !e.algumaFerramenta.some(f => usadas.includes(f))) {
    falhas.push(`não usou nenhuma de: ${e.algumaFerramenta.join(', ')} (usou: ${usadas.join(', ') || 'nenhuma'})`)
  }
  if (e.semFerramentas && usadas.length > 0) falhas.push(`não devia consultar (usou: ${usadas.join(', ')})`)
  for (const f of e.ferramentasProibidas ?? []) if (usadas.includes(f)) falhas.push(`usou ${f}`)
  if (e.chamada && !done.trilha.some(t => t.nome === e.chamada!.nome && contem(t.args, e.chamada!.args))) {
    falhas.push(`faltou chamada ${e.chamada.nome}(${JSON.stringify(e.chamada.args)})`)
  }
  const semLastro = done.meta?.lastro.semLastro ?? []
  if (e.lastro !== false && semLastro.length > 0) falhas.push(`valores sem origem: ${semLastro.join(', ')}`)
  if (/Não consegui formular a resposta/.test(done.texto)) falhas.push('sem resposta')
  return falhas
}
