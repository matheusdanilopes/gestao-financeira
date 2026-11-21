import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAwesome, parseBcb, parseYahoo, parseRss, mesclarNoticias, tempoRelativo, formatarCotacao,
} from '@/lib/mercado'

test('parseAwesome lê bid e pctChange e ignora pares ausentes', () => {
  const json = { USDBRL: { bid: '5.4210', pctChange: '0.31' }, EURBRL: { bid: 'x' } }
  const r = parseAwesome(json, [
    { chave: 'USDBRL', nome: 'USD' }, { chave: 'EURBRL', nome: 'EUR' }, { chave: 'BTCBRL', nome: 'BTC' },
  ])
  assert.deepEqual(r, [{ nome: 'USD', valor: 5.421, formato: 'brl', variacao: 0.31 }])
  assert.deepEqual(parseAwesome(null, [{ chave: 'USDBRL', nome: 'USD' }]), [])
})

test('parseBcb devolve o último valor da série', () => {
  assert.equal(parseBcb([{ data: '20/11/2026', valor: '10.50' }, { data: '21/11/2026', valor: '10.75' }]), 10.75)
  assert.equal(parseBcb([]), null)
  assert.equal(parseBcb({ erro: 1 }), null)
})

test('parseYahoo calcula a variação sobre o fechamento anterior', () => {
  const r = parseYahoo({ chart: { result: [{ meta: { regularMarketPrice: 101, chartPreviousClose: 100 } }] } })
  assert.equal(r?.valor, 101)
  assert.ok(Math.abs((r?.variacao ?? 0) - 1) < 1e-9)
  assert.equal(parseYahoo({ chart: { result: [] } }), null)
})

test('parseRss lê título com CDATA, entidades e data', () => {
  const xml = `<rss><channel><title>Canal</title>
    <item><title><![CDATA[Copom mantém Selic &amp; sinaliza]]></title><link>https://ex.com/a</link><pubDate>Fri, 20 Nov 2026 12:00:00 -0300</pubDate></item>
    <item><title>Sem link</title></item>
    <item><title>Link inválido</title><link>javascript:alert(1)</link></item>
  </channel></rss>`
  const r = parseRss(xml, 'Fonte')
  assert.equal(r.length, 1)
  assert.equal(r[0].titulo, 'Copom mantém Selic & sinaliza')
  assert.equal(r[0].link, 'https://ex.com/a')
  assert.equal(r[0].data, '2026-11-20T15:00:00.000Z')
})

test('mesclarNoticias ordena por data e remove títulos repetidos', () => {
  const a = { fonte: 'A', titulo: 'X', link: 'https://a', data: '2026-11-20T10:00:00.000Z' }
  const b = { fonte: 'B', titulo: 'Y', link: 'https://b', data: '2026-11-20T12:00:00.000Z' }
  const c = { fonte: 'C', titulo: 'x', link: 'https://c', data: '2026-11-20T09:00:00.000Z' }
  assert.deepEqual(mesclarNoticias([[a, c], [b]]).map(n => n.fonte), ['B', 'A'])
})

test('tempoRelativo e formatarCotacao', () => {
  const agora = Date.parse('2026-11-20T12:00:00Z')
  assert.equal(tempoRelativo('2026-11-20T11:48:00Z', agora), 'há 12 min')
  assert.equal(tempoRelativo('2026-11-20T09:00:00Z', agora), 'há 3 h')
  assert.equal(tempoRelativo(null, agora), '')
  assert.equal(formatarCotacao({ nome: 'SELIC', valor: 10.75, formato: 'taxa', variacao: null }), '10,75%')
  assert.equal(formatarCotacao({ nome: 'USD', valor: 5.4213, formato: 'brl', variacao: 0 }), 'R$ 5,42')
})
