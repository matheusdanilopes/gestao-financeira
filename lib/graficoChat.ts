/**
 * Gráfico dentro da resposta do assessor.
 *
 * O modelo escreve um bloco cercado ```grafico com JSON; o chat do app
 * desenha, o Telegram converte em lista. O JSON é validado aqui: qualquer
 * coisa fora do formato vira null e o bloco não é desenhado — nunca um
 * gráfico com números trocados de lugar.
 *
 *   ```grafico
 *   {"tipo":"barra","titulo":"Gastos por categoria — SET/26",
 *    "rotulos":["Mercado","Transporte"],
 *    "series":[{"nome":"SET/26","valores":[812.4,553.56]}]}
 *   ```
 */

export type TipoGrafico = 'barra' | 'barra_horizontal' | 'linha'
export type UnidadeGrafico = 'brl' | 'pct' | 'numero'

export interface SerieGrafico {
  nome: string
  valores: number[]
}

export interface EspecGrafico {
  tipo: TipoGrafico
  titulo: string
  rotulos: string[]
  series: SerieGrafico[]
  unidade: UnidadeGrafico
}

export const LINGUAGEM_GRAFICO = 'grafico'
/** Mais que isso não se lê numa tela de celular. */
export const MAX_SERIES = 4
export const MAX_ROTULOS = 12

const TIPOS: TipoGrafico[] = ['barra', 'barra_horizontal', 'linha']
const UNIDADES: UnidadeGrafico[] = ['brl', 'pct', 'numero']

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}

export function lerGrafico(json: string): EspecGrafico | null {
  let bruto: unknown
  try { bruto = JSON.parse(json) } catch { return null }
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>

  const tipo = TIPOS.includes(o.tipo as TipoGrafico) ? (o.tipo as TipoGrafico) : 'barra'
  const unidade = UNIDADES.includes(o.unidade as UnidadeGrafico) ? (o.unidade as UnidadeGrafico) : 'brl'
  const titulo = typeof o.titulo === 'string' ? o.titulo.trim().slice(0, 80) : ''
  if (!Array.isArray(o.rotulos) || !Array.isArray(o.series)) return null

  const rotulos = o.rotulos.map(r => String(r ?? '').slice(0, 24)).slice(0, MAX_ROTULOS)
  if (rotulos.length === 0) return null

  const series: SerieGrafico[] = []
  for (const s of o.series.slice(0, MAX_SERIES)) {
    if (!s || typeof s !== 'object') return null
    const { nome, valores } = s as Record<string, unknown>
    if (!Array.isArray(valores) || valores.length < rotulos.length) return null
    const nums = valores.slice(0, rotulos.length).map(numero)
    if (nums.some(n => n === null)) return null
    series.push({ nome: typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, 32) : `Série ${series.length + 1}`, valores: nums as number[] })
  }
  if (series.length === 0) return null

  return { tipo, titulo, rotulos, series, unidade }
}

export function formatarValorGrafico(v: number, unidade: UnidadeGrafico): string {
  if (unidade === 'pct') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  if (unidade === 'numero') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Versão em texto — para o Telegram, a leitura em voz alta e a tabela do gráfico. */
export function graficoEmTexto(g: EspecGrafico): string {
  const linhas = g.titulo ? [`**${g.titulo}**`] : []
  for (let i = 0; i < g.rotulos.length; i++) {
    const valores = g.series.map(s =>
      g.series.length > 1 ? `${s.nome} ${formatarValorGrafico(s.valores[i], g.unidade)}` : formatarValorGrafico(s.valores[i], g.unidade))
    linhas.push(`- ${g.rotulos[i]}: ${valores.join(' · ')}`)
  }
  return linhas.join('\n')
}

/** Troca cada bloco ```grafico do markdown pela versão em texto (ou remove, se inválido). */
export function substituirGraficosPorTexto(markdown: string): string {
  return markdown.replace(/```grafico[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, json: string) => {
    const g = lerGrafico(json.trim())
    return g ? graficoEmTexto(g) : ''
  })
}
