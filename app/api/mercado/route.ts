import { NextResponse } from 'next/server'
import { parseAwesome, parseBcb, parseYahoo, type Cotacao } from '@/lib/mercado'

// Cotações da faixa do Dashboard. Dados públicos (sem dados do usuário), com
// cache de 15 min no servidor: o app não consulta as fontes a cada abertura.
// Cada fonte falha sozinha — o que não responder fica fora da faixa.
export const revalidate = 900

const CACHE = { next: { revalidate: 900 } }
const TIMEOUT_MS = 6000

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, ...CACHE, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

const YAHOO_INIT: RequestInit = { headers: { 'User-Agent': 'Mozilla/5.0' } }
const yahoo = (simbolo: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=1d`
const bcb = (serie: number) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`

export async function GET() {
  const [moedas, ibov, sp, selic, cdi, ipca] = await Promise.allSettled([
    getJson('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL'),
    getJson(yahoo('^BVSP'), YAHOO_INIT),
    getJson(yahoo('^GSPC'), YAHOO_INIT),
    getJson(bcb(432)),   // Selic meta (% a.a.)
    getJson(bcb(4389)),  // CDI anualizado base 252 (% a.a.)
    getJson(bcb(13522)), // IPCA acumulado em 12 meses (%)
  ])
  const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)

  const cotacoes: Cotacao[] = []
  const porPar = parseAwesome(ok(moedas), [
    { chave: 'USDBRL', nome: 'USD' }, { chave: 'EURBRL', nome: 'EUR' }, { chave: 'BTCBRL', nome: 'BTC' },
  ])
  const add = (c: Cotacao | null | undefined) => { if (c) cotacoes.push(c) }

  add(porPar.find(c => c.nome === 'USD'))
  add(porPar.find(c => c.nome === 'EUR'))
  const ib = parseYahoo(ok(ibov))
  if (ib) add({ nome: 'IBOV', formato: 'pontos', ...ib })
  for (const [nome, r] of [['SELIC', selic], ['CDI', cdi], ['IPCA 12m', ipca]] as const) {
    const v = parseBcb(ok(r))
    if (v !== null) add({ nome, valor: v, formato: 'taxa', variacao: null })
  }
  add(porPar.find(c => c.nome === 'BTC'))
  const s = parseYahoo(ok(sp))
  if (s) add({ nome: 'S&P 500', formato: 'pontos', ...s })

  return NextResponse.json(
    { cotacoes, atualizadoEm: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' } },
  )
}
