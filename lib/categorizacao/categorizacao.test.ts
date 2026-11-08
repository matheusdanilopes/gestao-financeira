/**
 * Categorização — normalização, regras, memória e pipeline, com descrições
 * reais da fatura e os defeitos encontrados em 08/11/2026. Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarEstabelecimento, ehMesmaCompra, descricaoSemParcela, chaveDeMemoriaAntiga } from './normalizacao'
import { aplicarRegras } from './regras'
import { MemoriaCategorias } from './memoria'
import { resolverNomeCategoria, montarPromptCategorizacao, classificarLoteIA } from './ia'
import { decidirCategorias, type TransacaoParaCategorizar } from './pipeline'
import { GeminiError, type RodadaGemini } from '../ai/agent/geminiClient'
import type { OpcoesChamada } from '../ai/agent/geminiClient'

// Categorias configuradas pelo casal (configuracoes.categorias_compras).
const PERMITIDAS = ['Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Moradia', 'Vestuário',
  'Tecnologia', 'Serviços', 'Viagem', 'Outros', 'Presente', 'Combustível', 'Cosméticos', 'Festa', 'Beleza']

// ─── Normalização ────────────────────────────────────────────────────────────

test('estabelecimento: tira maquininha, parcela (todos os formatos), responsável e NuPay', () => {
  const casos: Array<[string, string]> = [
    ['Mercadolivre*Blzcosme - Parcela 1/5', 'mercadolivre blzcosme'],
    ['Mp *Melimais', 'melimais'],
    ['Dl *Uberrides', 'uberrides'],
    ['Ifd*Comercio de Medica - Parcela 1/3', 'comercio de medica'],
    ['Zp*Thaynara - Jeniffer', 'thaynara'],
    ['Jim.Com* 26646848 Luan', 'luan'],
    ['Thiagoarruda Parc 7/10', 'thiagoarruda'],
    ['ifood - nupay - 2/2', 'ifood'],
    ['Ingresso.com - NuPay - 1/3', 'ingresso com'],
    ['Magalu *mparc04/10 (Parcela 4 de 10)', 'magalu mparc'],
    ['Magalu *Mparc - Parcela 7/10', 'magalu mparc'],
    ['Pg *wix Havefuparc05/12 (Parcela 5 de 12)', 'wix havefu'],
    ['Pg *Wix Havefu - Parcela 8/12', 'wix havefu'],
    ['IOF de "Claude.Ai Subscription"', 'claude ai subscription'],
    ['iFood Remédios - Jeniffer - Parcela 1/3', 'ifood remedios'],
  ]
  for (const [descricao, chave] of casos) assert.equal(normalizarEstabelecimento(descricao).chave, chave, descricao)
})

test('marketplace sem vendedor é genérico; com vendedor, guarda a pista', () => {
  assert.ok(normalizarEstabelecimento('Mercadolivre*Mercadol - Parcela 2/5').generico)
  assert.ok(normalizarEstabelecimento('Havan Maringa Avenida - Parcela 4/10').generico)
  assert.ok(normalizarEstabelecimento('Mercado Livre - Jeniffer').generico)
  const blz = normalizarEstabelecimento('Mercadolivre*Blzcosme')
  assert.ok(blz.marketplace && !blz.generico)
  assert.equal(blz.vendedor, 'blzcosme')
  assert.ok(!normalizarEstabelecimento('Mercado Varej?o').marketplace, '"Mercado Varejão" é uma loja, não marketplace')
})

test('memória antiga (sem asterisco, com "PARCELA 1 6") vira a mesma chave', () => {
  assert.equal(chaveDeMemoriaAntiga('MERCADOLIVRE MERCADOL PARCELA 1 6'), 'mercadolivre mercadol')
  assert.equal(chaveDeMemoriaAntiga('MP MELIMAIS'), 'melimais')
  assert.equal(chaveDeMemoriaAntiga('IFD COMERCIO DE MEDICA'), 'comercio de medica')
})

test('mesma compra: parcelas com centavos de diferença sim; outra compra na mesma loja não', () => {
  const p1 = { descricao: 'Havan Maringa Avenida - Parcela 1/10', total_parcelas: 10, responsavel: 'Jeniffer', valor: 25.55 }
  assert.ok(ehMesmaCompra(p1, { ...p1, descricao: 'Havan Maringa Avenida - Parcela 2/10', valor: 25.49 }))
  assert.ok(!ehMesmaCompra(p1, { ...p1, descricao: 'Havan Maringa Avenida - Parcela 5/10', valor: 16.99 }))
  assert.ok(!ehMesmaCompra(p1, { ...p1, responsavel: 'Matheus' }))
  assert.ok(!ehMesmaCompra({ ...p1, total_parcelas: 1 }, { ...p1, total_parcelas: 1 }), 'compra à vista não tem irmãs')
  assert.equal(descricaoSemParcela('Havan Maringa Avenida - Parcela 1/10'), 'Havan Maringa Avenida')
})

// ─── Regras ──────────────────────────────────────────────────────────────────

test('regras acertam os estabelecimentos inequívocos dos rótulos reais', () => {
  const casos: Array<[string, number, string]> = [
    ['Dl *Uberrides', 10.94, 'Transporte'],
    ['Uber - NuPay', 0.84, 'Transporte'],
    ['NuTag*BDU7E27', 17, 'Transporte'],
    ['Estacionamentoclm', 20, 'Transporte'],
    ['Ifd*Ifood Club', 8.97, 'Alimentação'],
    ['Ifd*Castelini Pizzaria', 82.02, 'Alimentação'],
    ['Panificadora Luz', 45.89, 'Alimentação'],
    ['Sorveteria Cerro Azul', 68.84, 'Alimentação'],
    ['Farmacia Sao Joao - Parcela 2/2', 179.89, 'Saúde'],
    ['Raia1485', 104.55, 'Saúde'],
    ['Drog Nissei 263 Maring', 63.57, 'Saúde'],
    ['iFood Remédios - Jeniffer - Parcela 1/3', 39.2, 'Saúde'],
    ['Pilates Conce', 210, 'Saúde'],
    ['Comercial Otica - Parcela 1/10', 400, 'Saúde'],
    ['Ifd*Comercio de Medica', 45.27, 'Saúde'],
    ['Apple.Com/Bill', 66.9, 'Tecnologia'],
    ['Anthropic* Claude Sub', 114.09, 'Tecnologia'],
    ['IOF de "Claude.Ai Subscription"', 3.99, 'Tecnologia'],
    ['Google One', 24.99, 'Tecnologia'],
    ['Lojas Renner Fl - Parcela 1/3', 176.6, 'Vestuário'],
    ['Seralle Calcados - Parcela 1/12', 14.76, 'Vestuário'],
    ['Hna*Oboticario - Parcela 1/6', 35.45, 'Cosméticos'],
    ['Hna*Eudora - Parcela 2/6', 42.48, 'Cosméticos'],
    ['Assai Atacadista Lj79', 131.81, 'Mercado'],
    ['Supermercado Veneza', 13.98, 'Mercado'],
    ['Netflix.Com', 20.9, 'Lazer'], // sem "Streaming" configurado, cai em Lazer
    ['Amazon Kindle Unltd', 24.9, 'Lazer'],
    ['Ingresso.com - NuPay - 1/3', 19.72, 'Lazer'],
    ['Decolar C - NuPay - Parcela 5/12', 35.14, 'Viagem'],
    ['Posto Sao Vicente', 115.5, 'Combustível'],
    ['Vegas Auto Posto Vegas', 8.99, 'Alimentação'], // lanche na conveniência
  ]
  for (const [descricao, valor, esperado] of casos) {
    const r = aplicarRegras(normalizarEstabelecimento(descricao).chave, valor, PERMITIDAS)
    assert.equal(r?.categoria, esperado, `${descricao} (R$ ${valor})`)
  }
})

test('regras não decidem o ambíguo nem usam categoria não configurada', () => {
  assert.equal(aplicarRegras('posto bosque ii', 45, PERMITIDAS), null, 'posto entre R$ 30 e R$ 60: deixa para memória/IA')
  assert.equal(aplicarRegras('mercadolivre mercadol', 50, PERMITIDAS), null)
  assert.equal(aplicarRegras('thaynara', 90, PERMITIDAS), null)
  assert.equal(aplicarRegras('petz', 80, PERMITIDAS), null, 'Pet não está nas categorias do casal')
  assert.equal(aplicarRegras('petz', 80, [...PERMITIDAS, 'Pet'])?.categoria, 'Pet')
})

// ─── Memória ─────────────────────────────────────────────────────────────────

test('memória nunca aplica "Outros" (o ciclo que espalhou 123 compras)', () => {
  const m = new MemoriaCategorias([
    { descricao: 'HAVAN MARINGA AVENIDA PARCELA 1 5', categoria: 'Outros', peso: 3, formatoAntigo: true },
    { descricao: 'J Z COMERCIO DE MEDI', categoria: 'Outros', peso: 2, formatoAntigo: true },
  ], PERMITIDAS)
  assert.equal(m.consultar('J Z Comercio de Medi'), null)
  assert.equal(m.tamanho, 0)
})

test('memória não decide por marketplace genérico, mesmo com rótulos', () => {
  const m = new MemoriaCategorias([
    { descricao: 'MERCADOLIVRE MERCADOL PARCELA 1 6', categoria: 'Cosméticos', peso: 4, formatoAntigo: true },
    { descricao: 'Mercadolivre*Mercadol', categoria: 'Mercado', peso: 1 },
  ], PERMITIDAS)
  assert.equal(m.consultar('Mercadolivre*Mercadol - Parcela 3/3'), null)
})

test('memória decide quando uma categoria domina; com rótulos divergentes, não', () => {
  const m = new MemoriaCategorias([
    { descricao: 'Mgamercadinho24h', categoria: 'Alimentação', peso: 36 },
    { descricao: 'Mgamercadinho24h', categoria: 'Mercado', peso: 2 },
    { descricao: 'Posto Bosque Ii', categoria: 'Alimentação', peso: 5 },
    { descricao: 'Posto Bosque Ii', categoria: 'Combustível', peso: 3 },
    { descricao: 'MP MELIMAIS', categoria: 'Tecnologia', peso: 7, formatoAntigo: true },
  ], PERMITIDAS)
  assert.equal(m.consultar('Mgamercadinho24h')?.categoria, 'Alimentação')
  assert.equal(m.consultar('Posto Bosque Ii'), null, '5×3 não é dominante: a IA decide vendo os dois')
  assert.equal(m.consultar('Mp *Melimais')?.categoria, 'Tecnologia', 'formato antigo casa com o novo')
})

test('memória reconhece a mesma loja escrita de outro jeito', () => {
  const m = new MemoriaCategorias([{ descricao: 'Lojas Renner Fl', categoria: 'Vestuário', peso: 17 }], PERMITIDAS)
  assert.equal(m.consultar('Lojas Renner Fl 476 Sh - Parcela 2/3')?.categoria, 'Vestuário')
  assert.equal(m.consultar('Lojas Americanas'), null)
})

test('exemplos gerais trazem variedade de categorias', () => {
  const entradas = [
    ...Array.from({ length: 10 }, (_, i) => ({ descricao: `Restaurante ${i} Teste`, categoria: 'Alimentação', peso: 50 - i })),
    { descricao: 'Drogaria Teste', categoria: 'Saúde', peso: 1 },
  ]
  const ex = new MemoriaCategorias(entradas, PERMITIDAS).exemplosGerais(5, 3)
  assert.equal(ex.length, 5)
  assert.ok(ex.some(e => e.categoria === 'Saúde'), 'a categoria rara aparece')
})

// ─── IA: nomes, prompt e resposta ────────────────────────────────────────────

test('nome de categoria devolvido pela IA é resolvido sem cair em "Outros"', () => {
  assert.equal(resolverNomeCategoria('Alimentacao', PERMITIDAS), 'Alimentação')
  assert.equal(resolverNomeCategoria('SAÚDE', PERMITIDAS), 'Saúde')
  assert.equal(resolverNomeCategoria('Supermercado', PERMITIDAS), 'Mercado')
  assert.equal(resolverNomeCategoria('Restaurante', PERMITIDAS), 'Alimentação')
  assert.equal(resolverNomeCategoria('Pet', PERMITIDAS), null, 'categoria fora da configuração não é inventada')
  assert.equal(resolverNomeCategoria('', PERMITIDAS), null)
})

test('prompt leva o contexto que faltava e trata "Outros" como último recurso', () => {
  const p = montarPromptCategorizacao([{
    id: '1', descricao: 'Havan Maringa Avenida - Parcela 1/10', nomePersonalizado: 'Shorts p/ Jogar e calcinhas Havan',
    chave: 'havan maringa avenida', valor: 25.55, parcelas: '1/10', responsavel: 'Jeniffer', marketplace: true,
    exemplos: [{ chave: 'genko mulher', categoria: 'Vestuário' }],
  }], PERMITIDAS, [{ chave: 'mgamercadinho24h', categoria: 'Alimentação' }], { ifd: 'pago pelo iFood' })
  assert.match(p, /nome dado pelo casal: "Shorts p\/ Jogar e calcinhas Havan"/)
  assert.match(p, /R\$ 25,55 · parcela 1\/10 · de: Jeniffer/)
  assert.match(p, /marketplace sem vendedor/)
  assert.match(p, /"mgamercadinho24h" → Alimentação/)
  assert.match(p, /"IFD\*" = pago pelo iFood/)
  assert.match(p, /- Outros: ÚLTIMO recurso/)
  assert.doesNotMatch(p, /- Pet:/, 'só as categorias configuradas')
})

const respostaIA = (itens: unknown[]) => async (_o: OpcoesChamada): Promise<RodadaGemini> =>
  ({ texto: JSON.stringify({ itens }), chamadas: [] })

test('resposta da IA: por id, com esquema restrito às categorias; falta de id não vira "Outros"', async () => {
  let enviado: OpcoesChamada | undefined
  const gerar = async (o: OpcoesChamada) => {
    enviado = o
    return respostaIA([
      { id: '2', categoria: 'Alimentacao', confianca: 0.9, motivo: 'pizzaria' },
      { id: '1', categoria: 'Saúde', confianca: 1.7 },
      { id: '9', categoria: 'Lazer', confianca: 0.9 }, // id que não existe
    ])(o)
  }
  const itens = ['Farmacia X', 'Pizzaria Y', 'Loja Z'].map((d, i) => ({ id: String(i + 1), descricao: d, chave: d.toLowerCase(), valor: 10 }))
  const r = await classificarLoteIA(itens, PERMITIDAS, [], {}, { apiKey: 'x', deadlineMs: Date.now() + 5_000, gerar })
  assert.equal(r.get('1')?.categoria, 'Saúde')
  assert.equal(r.get('1')?.confianca, 1, 'confiança limitada a 1')
  assert.equal(r.get('2')?.categoria, 'Alimentação')
  assert.equal(r.has('3'), false)
  assert.equal(r.has('9'), false)
  const schema = enviado?.responseSchema as { properties: { itens: { items: { properties: { categoria: { enum: string[] } } } } } }
  assert.deepEqual(schema.properties.itens.items.properties.categoria.enum, PERMITIDAS)
  assert.equal(enviado?.responseMimeType, 'application/json')
})

// ─── Pipeline ────────────────────────────────────────────────────────────────

const tx = (hash: string, descricao: string, valor: number, extra: Partial<TransacaoParaCategorizar> = {}): TransacaoParaCategorizar =>
  ({ hash_linha: hash, descricao, valor, responsavel: 'Jeniffer', ...extra })

function iaFalsa(responder: (ids: string[], prompt: string) => unknown[], registro: string[] = []) {
  return {
    apiKey: 'x',
    deadlineMs: Date.now() + 30_000,
    gerar: async (o: OpcoesChamada) => {
      const prompt = String(o.contents[0].parts[0].text)
      registro.push(prompt)
      const ids = [...prompt.matchAll(/^- id=(\d+)/gm)].map(m => m[1])
      return respostaIA(responder(ids, prompt))(o)
    },
  }
}

test('ordem das fontes: parcela → memória → regra → IA', async () => {
  const memoria = new MemoriaCategorias([{ descricao: 'Vegas Auto Posto Vegas', categoria: 'Alimentação', peso: 10 }], PERMITIDAS)
  const prompts: string[] = []
  const r = await decidirCategorias([
    tx('a', 'Donzella - Parcela 2/6', 171.59, { total_parcelas: 6, parcela_atual: 2 }),
    tx('b', 'Vegas Auto Posto Vegas', 150), // memória vence a regra de posto (que diria Combustível)
    tx('c', 'Dl *Uberrides', 12),
    tx('d', 'Tk Copacabana', 134),
  ], {
    permitidas: PERMITIDAS,
    memoria,
    categorizadas: [{ descricao: 'Donzella - Parcela 1/6', total_parcelas: 6, valor: 171.59, responsavel: 'Jeniffer', categoria: 'Vestuário', categoria_origem: 'MANUAL' }],
    ia: iaFalsa(ids => ids.map(id => ({ id, categoria: 'Alimentação', confianca: 0.8, motivo: 'restaurante' })), prompts),
  })
  const por = Object.fromEntries(r.decisoes.map(d => [d.hash_linha, `${d.origem}:${d.categoria}`]))
  assert.deepEqual(por, { a: 'PARCELA:Vestuário', b: 'HISTORICO:Alimentação', c: 'REGRA:Transporte', d: 'IA:Alimentação' })
  assert.equal(r.chamadasIA, 1)
  assert.equal(prompts.length, 1)
  assert.match(prompts[0], /Tk Copacabana/)
  assert.doesNotMatch(prompts[0], /Uberrides|Donzella|Vegas/, 'a IA só vê o que sobrou')
})

test('parcelas da mesma compra recebem a mesma categoria e vão uma vez só para a IA', async () => {
  const prompts: string[] = []
  const r = await decidirCategorias([
    tx('p1', 'Havan Maringa Avenida - Parcela 1/10', 25.55, { total_parcelas: 10, parcela_atual: 1, descricao_personalizada: 'Shorts p/ Jogar e calcinhas Havan' }),
    tx('p2', 'Havan Maringa Avenida - Parcela 2/10', 25.49, { total_parcelas: 10, parcela_atual: 2 }),
    tx('p5', 'Havan Maringa Avenida - Parcela 5/10', 16.99, { total_parcelas: 10, parcela_atual: 5 }),
  ], {
    permitidas: PERMITIDAS,
    memoria: new MemoriaCategorias([], PERMITIDAS),
    categorizadas: [],
    ia: iaFalsa((ids, prompt) => ids.map(id => ({
      id,
      categoria: prompt.includes(`id=${id} · fatura: "Havan Maringa Avenida - Parcela 1/10"`) ? 'Vestuário' : 'Moradia',
      confianca: 0.8,
    })), prompts),
  })
  const cat = Object.fromEntries(r.decisoes.map(d => [d.hash_linha, d.categoria]))
  assert.equal(cat.p1, 'Vestuário')
  assert.equal(cat.p2, 'Vestuário', 'mesma compra, mesma categoria')
  assert.equal(cat.p5, 'Moradia', 'outra compra na mesma loja decide sozinha')
  assert.equal((prompts[0].match(/^- id=/gm) ?? []).length, 2, 'duas compras, não três parcelas')
  assert.match(prompts[0], /Shorts p\/ Jogar/, 'o nome dado pelo casal chega à IA')
})

test('palpite fraco e "Outros" ficam para revisão; falha técnica não vira "Outros"', async () => {
  const r = await decidirCategorias([
    tx('x', 'Thayslorenagaspar', 50),
    tx('y', 'B1', 30),
    tx('z', 'Loja Que A Ia Esqueceu', 10),
  ], {
    permitidas: PERMITIDAS,
    memoria: new MemoriaCategorias([], PERMITIDAS),
    categorizadas: [],
    ia: iaFalsa(() => [
      { id: '1', categoria: 'Beleza', confianca: 0.4, motivo: 'nome de pessoa, valor de serviço' },
      { id: '2', categoria: 'Outros', confianca: 0.2 },
    ]),
  })
  const d = Object.fromEntries(r.decisoes.map(x => [x.hash_linha, x]))
  assert.equal(d.x.categoria, 'Beleza')
  assert.equal(d.x.status, 'revisao_pendente')
  assert.equal(d.y.status, 'revisao_pendente')
  assert.equal(d.z, undefined)
  assert.deepEqual(r.semDecisao, ['z'])
})

test('cota diária esgotada: para de chamar a IA e deixa o resto sem categoria', async () => {
  let chamadas = 0
  const r = await decidirCategorias(
    Array.from({ length: 30 }, (_, i) => tx(`h${i}`, `Loja Desconhecida ${i}`, 10 + i)),
    {
      permitidas: PERMITIDAS,
      memoria: new MemoriaCategorias([], PERMITIDAS),
      categorizadas: [],
      ia: {
        apiKey: 'x', deadlineMs: Date.now() + 30_000, tamanhoLote: 10,
        gerar: async () => { chamadas++; throw new GeminiError('cota', 'QUOTA', { diaria: true }) },
      },
    }
  )
  assert.equal(chamadas, 1)
  assert.ok(r.cotaDiariaEsgotada)
  assert.equal(r.decisoes.length, 0)
  assert.equal(r.semDecisao.length, 30)
})

test('sem chave de IA: decide o que dá sem ela e não inventa o resto', async () => {
  const r = await decidirCategorias([tx('a', 'Dl *Uberrides', 10), tx('b', 'Loja Misteriosa', 20)], {
    permitidas: PERMITIDAS, memoria: new MemoriaCategorias([], PERMITIDAS), categorizadas: [],
  })
  assert.deepEqual(r.decisoes.map(d => d.hash_linha), ['a'])
  assert.deepEqual(r.semDecisao, ['b'])
})
