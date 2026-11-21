// Cotações e notícias do Dashboard: parsers puros das fontes públicas usadas
// por /api/mercado e /api/noticias. Ficam separados das rotas para serem
// testados sem rede (lib/mercado.test.ts).

export interface Cotacao {
  /** Rótulo curto exibido na faixa (USD, IBOV, SELIC…). */
  nome: string
  valor: number
  /** Como formatar o valor: moeda (R$), pontos (índice) ou taxa (%). */
  formato: 'brl' | 'pontos' | 'taxa'
  /** Variação do dia em %; null para taxas (Selic, CDI, IPCA). */
  variacao: number | null
}

export interface Noticia {
  fonte: string
  titulo: string
  link: string
  /** ISO 8601; null quando o feed não informa a data. */
  data: string | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** AwesomeAPI (/json/last/USD-BRL,…): { USDBRL: { bid, pctChange }, … } */
export function parseAwesome(json: unknown, pares: { chave: string; nome: string }[]): Cotacao[] {
  if (!json || typeof json !== 'object') return []
  const obj = json as Record<string, { bid?: unknown; pctChange?: unknown } | undefined>
  const out: Cotacao[] = []
  for (const { chave, nome } of pares) {
    const valor = num(obj[chave]?.bid)
    if (valor === null) continue
    out.push({ nome, valor, formato: 'brl', variacao: num(obj[chave]?.pctChange) })
  }
  return out
}

/** Banco Central SGS (/dados/ultimos/1): [{ data, valor }] — devolve o último valor. */
export function parseBcb(json: unknown): number | null {
  if (!Array.isArray(json) || json.length === 0) return null
  return num((json[json.length - 1] as { valor?: unknown })?.valor)
}

/** Yahoo Finance chart (/v8/finance/chart/^BVSP): preço atual e variação sobre o fechamento anterior. */
export function parseYahoo(json: unknown): { valor: number; variacao: number | null } | null {
  const meta = (json as { chart?: { result?: { meta?: Record<string, unknown> }[] } })?.chart?.result?.[0]?.meta
  if (!meta) return null
  const valor = num(meta.regularMarketPrice)
  if (valor === null) return null
  const anterior = num(meta.chartPreviousClose ?? meta.previousClose)
  const variacao = anterior ? ((valor - anterior) / anterior) * 100 : null
  return { valor, variacao }
}

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

function decodificar(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(bloco: string, nome: string): string | null {
  const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i'))
  return m ? decodificar(m[1]) : null
}

/** RSS 2.0 (<item><title/><link/><pubDate/></item>). Ignora itens sem título ou link http(s). */
export function parseRss(xml: string, fonte: string, limite = 10): Noticia[] {
  const out: Noticia[] = []
  const itens = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const item of itens) {
    const titulo = tag(item, 'title')
    const link = tag(item, 'link') ?? tag(item, 'guid')
    if (!titulo || !link || !/^https?:\/\//i.test(link)) continue
    const pub = tag(item, 'pubDate') ?? tag(item, 'dc:date')
    const d = pub ? new Date(pub) : null
    out.push({ fonte, titulo, link, data: d && !isNaN(d.getTime()) ? d.toISOString() : null })
    if (out.length >= limite) break
  }
  return out
}

/** Junta as notícias de várias fontes, mais recentes primeiro, sem títulos repetidos. */
export function mesclarNoticias(listas: Noticia[][], limite = 12): Noticia[] {
  const vistos = new Set<string>()
  return listas
    .flat()
    .sort((a, b) => (b.data ? Date.parse(b.data) : 0) - (a.data ? Date.parse(a.data) : 0))
    .filter(n => {
      const k = n.titulo.toLowerCase()
      if (vistos.has(k)) return false
      vistos.add(k)
      return true
    })
    .slice(0, limite)
}

/** "há 12 min", "há 3 h", "há 2 d" — tempo desde a publicação. */
export function tempoRelativo(iso: string | null, agora = Date.now()): string {
  if (!iso) return ''
  const min = Math.max(0, Math.round((agora - Date.parse(iso)) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.round(h / 24)} d`
}

/** Valor da cotação como texto curto para a faixa. */
export function formatarCotacao(c: Cotacao): string {
  if (c.formato === 'taxa') return `${c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
  if (c.formato === 'pontos') return c.valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  const casas = c.valor >= 1000 ? 0 : 2
  return `R$ ${c.valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`
}
