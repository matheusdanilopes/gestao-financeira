/**
 * Conversa real de 08/11/2026 (Matheus, "Quanto gastei com iFood?"):
 *  1. a busca "ifood" não pegava os pedidos "IFD*Loja" — total 59% menor;
 *  2. o modelo mandou agrupar_por e calcular com "expressao" — ignorados;
 *  3. depois de 6 rodadas, a última (sem ferramentas) veio vazia e a pessoa
 *     recebeu "Não consegui formular a resposta" duas vezes.
 * Rodar: npm test
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { casaBusca, alternativasDeBusca, consultarTransacoes, construirReferencias } from './queryEngine'
import { normalizarArgumentos, executarFerramenta, type EstadoTurno } from './tools'
import type { ContextoEscrita } from './writeEngine'
import { simularGemini, restaurarFetch, rodarTurno, texto, chamada, gatewayFalso, dadosVazios, HOJE_TESTE } from './testes/apoio'

afterEach(restaurarFetch)

// ─── Busca ───────────────────────────────────────────────────────────────────

test('"ifood" inclui os pedidos que vêm na fatura como IFD*', () => {
  for (const d of ['Ifd*Castelini Pizzaria', 'IFD*Comercio de Medica', 'iFood - NuPay', 'Ifoodcom Agencia de R', 'Ifd*Ifood Club']) {
    assert.ok(casaBusca(d, 'ifood'), d)
  }
  assert.ok(!casaBusca('Padaria Ifdx', 'ifood'), 'só o prefixo IFD*, não qualquer "ifd"')
  assert.ok(!casaBusca('Panificadora Luz', 'ifood'))
  assert.ok(!casaBusca('iFood - NuPay', 'ifd'), 'a busca literal "ifd" continua literal')
})

test('vários termos com "|" ou "ou" valem como OU', () => {
  assert.deepEqual(alternativasDeBusca('ifood|ifd'), ['ifood', 'ifd'])
  assert.deepEqual(alternativasDeBusca('uber ou 99'), ['uber', '99'])
  assert.ok(casaBusca('Dl *Uberrides', 'ifood|uber'))
  assert.ok(casaBusca('Ifd*Pizzaria Herval', 'uber | ifood'))
  assert.ok(!casaBusca('Posto Jk', 'ifood|uber'))
})

test('consultar_transacoes com "ifood" soma os IFD* (o total que faltou na resposta)', () => {
  const data = dadosVazios({
    transacoes: [
      { id: '1', hash_linha: 'a', data: '2026-10-15', descricao: 'iFood - NuPay', valor: 83.5, responsavel: 'Matheus', projeto_fatura: '2026-11-01', cartao: 'nubank', categoria: 'Alimentação' },
      { id: '2', hash_linha: 'b', data: '2026-10-10', descricao: 'Ifd*Castelini Pizzaria', valor: 82.02, responsavel: 'Matheus', projeto_fatura: '2026-11-01', cartao: 'nubank', categoria: 'Alimentação' },
      { id: '3', hash_linha: 'c', data: '2026-10-12', descricao: 'Ifd*Comercio de Medica', valor: 45.27, responsavel: 'Matheus', projeto_fatura: '2026-11-01', cartao: 'nubank', categoria: 'Saúde' },
      { id: '4', hash_linha: 'd', data: '2026-10-12', descricao: 'Padaria Central', valor: 20, responsavel: 'Matheus', projeto_fatura: '2026-11-01', cartao: 'nubank', categoria: 'Alimentação' },
    ],
  })
  const r = consultarTransacoes(data, { busca: 'ifood', mesInicio: '2026-10', mesFim: '2026-10' }, construirReferencias(HOJE_TESTE))
  assert.match(r, /Total: R\$\s210,79 em 3 transação/)
  assert.match(r, /Ifd\*Comercio de Medica — R\$\s45,27 — .* — Saúde/, 'a farmácia via iFood entra, com a categoria dela')
})

// ─── Parâmetros ──────────────────────────────────────────────────────────────

test('nomes "quase certos" dos parâmetros são corrigidos; desconhecidos viram aviso', () => {
  assert.deepEqual(
    normalizarArgumentos('explorar_dados', { fonte: 'compras', agrupar_por: 'mes', limite: 10 }),
    { args: { fonte: 'compras', agruparPor: 'mes', limite: 10 }, ignorados: [] }
  )
  assert.deepEqual(normalizarArgumentos('calcular', { expressao: '1784.51 + 2561.59' }).args, { expressoes: '1784.51 + 2561.59' })
  assert.deepEqual(normalizarArgumentos('consultar_transacoes', { mes_inicio: '2026-01', cor: 'azul' }), {
    args: { mesInicio: '2026-01' }, ignorados: ['cor'],
  })
  // Forma declarada vence a variação, se vierem as duas.
  assert.deepEqual(normalizarArgumentos('explorar_dados', { agrupar_por: 'categoria', agruparPor: 'mes' }).args, { agruparPor: 'mes' })
})

const escrita = { ctx: {} as ContextoEscrita, estado: { propostaNesteTurno: false, propostas: [] } as EstadoTurno }

test('calcular com "expressao" no singular agora calcula', async () => {
  const r = await executarFerramenta('calcular', { expressao: '1784.51 + 2561.59' }, gatewayFalso(), construirReferencias(HOJE_TESTE), escrita)
  assert.match(r, /= 4\.346,1/)
  assert.doesNotMatch(r, /nenhuma expressão/)
})

test('parâmetro desconhecido volta como aviso no resultado', async () => {
  const r = await executarFerramenta('calcular', { expressoes: ['x: 1 + 1'], arredondar: true }, gatewayFalso(), construirReferencias(HOJE_TESTE), escrita)
  assert.match(r, /= 2/)
  assert.match(r, /Parâmetro\(s\) ignorado\(s\) por não existirem em calcular: arredondar\. Válidos: expressoes/)
})

// ─── Rodada final ────────────────────────────────────────────────────────────

test('depois de muitas consultas, rodada final vazia → síntese com o que já consultou', async () => {
  const enviados = simularGemini([
    // 6 rodadas consultando sem parar (como na conversa real)…
    [chamada('calcular', { expressoes: ['ifd: 2727.22'] })],
    [chamada('calcular', { expressoes: ['ifood: 1784.51'] })],
    [chamada('calcular', { expressoes: ['sobreposicao: 196.47'] })],
    [chamada('calcular', { expressoes: ['total: 1784.51 + 2561.59'] })],
    [chamada('calcular', { expressoes: ['qtd: 41 + 45'] })],
    [chamada('calcular', { expressoes: ['n: 86'] })],
    // …a rodada final volta vazia…
    [texto('')],
    // …e a síntese responde.
    [texto('Em 2026 você gastou **R$ 4.346,10** com iFood, contando os pedidos IFD*.')],
  ])
  const { done } = await rodarTurno('Quanto gastei com ifd e ifood?')

  assert.equal(done.texto, 'Em 2026 você gastou **R$ 4.346,10** com iFood, contando os pedidos IFD*.')
  assert.doesNotMatch(done.texto, /Não consegui formular/)
  const final = enviados[6] as unknown as { tools?: unknown; toolConfig: { functionCallingConfig: { mode: string } } }
  assert.ok(final.tools, 'ferramentas continuam declaradas na rodada final')
  assert.equal(final.toolConfig.functionCallingConfig.mode, 'NONE')
  const sintese = enviados[7]
  assert.match(sintese.url, /:generateContent/)
  assert.match(JSON.stringify(sintese.contents.at(-1)), /Responda agora à última pergunta/)
  assert.equal((sintese as unknown as { toolConfig: { functionCallingConfig: { mode: string } } }).toolConfig.functionCallingConfig.mode, 'NONE')
})

test('pedido de ferramenta na rodada final (proibida) é ignorado, não executado', async () => {
  const enviados = simularGemini([
    ...Array.from({ length: 6 }, () => [chamada('listar_dimensoes')]),
    [chamada('listar_dimensoes')], // desobedece o NONE
    [texto('Resumo com o que já vi.')],
  ])
  const { eventos, done } = await rodarTurno('Pergunta')
  assert.equal(eventos.filter(e => e.type === 'tool').length, 6, 'só as 6 rodadas permitidas consultaram')
  assert.equal(done.texto, 'Resumo com o que já vi.')
  assert.equal(enviados.length, 8)
})
