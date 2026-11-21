import { NextResponse } from 'next/server'
import { parseRss, mesclarNoticias, ehFinancasPessoais } from '@/lib/mercado'

// Notícias de finanças pessoais do Dashboard, a partir dos feeds RSS públicos.
// A seção "Minhas Finanças" do InfoMoney já é do tema; Valor e g1 Economia
// trazem de tudo (política, empresas…), então só passam as manchetes sobre o
// que mexe no bolso (lib/mercado → ehFinancasPessoais).
// Cache de 30 min no servidor; uma fonte fora do ar só some da lista.
export const revalidate = 1800

const FONTES = [
  { fonte: 'InfoMoney', url: 'https://www.infomoney.com.br/minhas-financas/feed/', filtrar: false },
  { fonte: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/', filtrar: true },
  { fonte: 'g1 Economia', url: 'https://g1.globo.com/rss/g1/economia/', filtrar: true },
  { fonte: 'Valor', url: 'https://pox.globo.com/rss/valor/', filtrar: true },
]

async function lerFeed(url: string, fonte: string) {
  const res = await fetch(url, {
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(6000),
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml, text/xml' },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return parseRss(await res.text(), fonte, 30)
}

export async function GET() {
  const resultados = await Promise.allSettled(FONTES.map(f => lerFeed(f.url, f.fonte)))
  const listas = resultados.map((r, i) => {
    if (r.status !== 'fulfilled') return []
    return FONTES[i].filtrar ? r.value.filter(n => ehFinancasPessoais(n.titulo)) : r.value
  })
  return NextResponse.json(
    { noticias: mesclarNoticias(listas, 12), atualizadoEm: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
  )
}
