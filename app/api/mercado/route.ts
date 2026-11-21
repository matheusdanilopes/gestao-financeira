import { NextResponse } from 'next/server'
import { parseAwesome, parseBcb, parseYahoo, type Cotacao } from '@/lib/mercado'

// Cotações da faixa do Dashboard: só o essencial — dólar, Ibovespa, Selic e
// inflação. Dados públicos (sem dados do usuário), com cache de 15 min no
// servidor. Cada fonte falha sozinha — o que não responder fica fora da faixa.
export const revalidate = 900

const CACHE = { next: { revalidate: 900 } }
const TIMEOUT_MS = 6000

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, ...CACHE, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

const bcb = (serie: number) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`

export async function GET() {
  const [moedas, ibov, selic, ipca] = await Promise.allSettled([
    getJson('https://economia.awesomeapi.com.br/json/last/USD-BRL'),
    getJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?range=1d&interval=1d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }),
    getJson(bcb(432)),   // Selic meta (% ao ano)
    getJson(bcb(13522)), // IPCA acumulado em 12 meses (%)
  ])
  const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)

  const cotacoes: Cotacao[] = [...parseAwesome(ok(moedas), [{ chave: 'USDBRL', nome: 'Dólar' }])]
  const ib = parseYahoo(ok(ibov))
  if (ib) cotacoes.push({ nome: 'Ibovespa', formato: 'pontos', ...ib })
  const s = parseBcb(ok(selic))
  if (s !== null) cotacoes.push({ nome: 'Selic', valor: s, formato: 'taxa', variacao: null, detalhe: 'ao ano' })
  const i = parseBcb(ok(ipca))
  if (i !== null) cotacoes.push({ nome: 'Inflação', valor: i, formato: 'taxa', variacao: null, detalhe: 'em 12 meses' })

  return NextResponse.json(
    { cotacoes, atualizadoEm: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' } },
  )
}
