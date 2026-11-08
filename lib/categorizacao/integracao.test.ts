/**
 * Categorização de ponta a ponta com Supabase em memória e Gemini simulado:
 * o que é selecionado em cada modo, o que é gravado, e o ciclo de aprendizado
 * que espalhava "Outros". Rodar: npm test
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { categorizarTransacoes } from '../categorizarTransacoes'
import { atualizarAprendizado, categoriaFoiEscolhida, origemAposEdicao } from '../ragClassificacao'
import { criarSupabaseFalso, restaurarFetch } from '../ai/agent/testes/apoio'
import type { SupabaseClient } from '@supabase/supabase-js'

afterEach(restaurarFetch)

const CATEGORIAS = JSON.stringify(['Alimentação', 'Mercado', 'Transporte', 'Saúde', 'Lazer', 'Moradia', 'Vestuário',
  'Tecnologia', 'Serviços', 'Outros', 'Presente', 'Combustível', 'Cosméticos', 'Beleza'])

/** Gemini falso: responde cada id do prompt com a categoria que `decidir` der para a linha. */
function iaPorLinha(decidir: (linha: string) => { categoria: string; confianca: number }) {
  const prompts: string[] = []
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body))
    const prompt = String(corpo.contents[0].parts[0].text)
    prompts.push(prompt)
    const itens = [...prompt.matchAll(/^- id=(\d+) · (.*)$/gm)].map(([, id, linha]) => ({ id, ...decidir(linha), motivo: 'teste' }))
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ itens }) }] }, finishReason: 'STOP' }] }), { status: 200 })
  }) as typeof fetch
  return prompts
}

const linha = (hash: string, descricao: string, valor: number, extra: Record<string, unknown> = {}) => ({
  hash_linha: hash, descricao, valor, responsavel: 'Jeniffer', data: '2026-10-10', is_estorno: false,
  categoria: null, categoria_origem: null, total_parcelas: null, parcela_atual: null, descricao_personalizada: null, ...extra,
})

function banco(transacoes: Array<Record<string, unknown>>, aprendidas: Array<Record<string, unknown>> = []) {
  const db = criarSupabaseFalso({
    configuracoes: [{ chave: 'categorias_compras', valor: CATEGORIAS }],
    transacoes_nubank: transacoes,
    classificacoes_aprendidas: aprendidas,
  })
  return { db, supabase: db.cliente as unknown as SupabaseClient }
}

const estado = (db: ReturnType<typeof criarSupabaseFalso>) =>
  Object.fromEntries(db.tabelas.transacoes_nubank.map(t => [t.hash_linha, `${t.categoria_origem}:${t.categoria}`]))

test('modo padrão: sem categoria + "Outros" automático; preserva escolha manual', async () => {
  const { db, supabase } = banco([
    linha('nova', 'Dl *Uberrides', 12),
    linha('outros-ia', 'Ifd*Castelini Pizzaria', 82, { categoria: 'Outros', categoria_origem: 'IA' }),
    linha('outros-hist', 'Havan Maringa Avenida - Parcela 5/10', 16.99, { categoria: 'Outros', categoria_origem: 'HISTORICO', total_parcelas: 10 }),
    linha('outros-manual', 'Giacomine Giacomine', 79.3, { categoria: 'Outros', categoria_origem: 'MANUAL' }),
    linha('ok-ia', 'Lojas Renner Fl', 100, { categoria: 'Vestuário', categoria_origem: 'IA' }),
    linha('estorno', 'Loja Estornada', 50, { is_estorno: true }),
  ])
  iaPorLinha(l => (l.includes('Havan') ? { categoria: 'Moradia', confianca: 0.55 } : { categoria: 'Outros', confianca: 0.1 }))

  const r = await categorizarTransacoes(supabase, 'chave')

  assert.equal(r.total, 3)
  assert.deepEqual(estado(db), {
    'nova': 'REGRA:Transporte',
    'outros-ia': 'REGRA:Alimentação',
    'outros-hist': 'IA:Moradia',
    'outros-manual': 'MANUAL:Outros',
    'ok-ia': 'IA:Vestuário',
    'estorno': 'null:null',
  })
  assert.equal(r.revisaoPendente, 1, 'o palpite de 0,55 fica para revisão')
  assert.deepEqual(r.porOrigem, { REGRA: 2, IA: 1 })
  const havan = db.tabelas.transacoes_nubank.find(t => t.hash_linha === 'outros-hist')!
  assert.equal(havan.classificacao_status, 'revisao_pendente')
  assert.equal(havan.categoria_confianca, 0.55)
})

test('importação (modo "novas") não mexe no que já tem categoria', async () => {
  const { db, supabase } = banco([
    linha('nova', 'Raia1485', 104.55),
    linha('velha', 'Ifd*Pizzaria Herval', 92, { categoria: 'Outros', categoria_origem: 'IA' }),
  ])
  const r = await categorizarTransacoes(supabase, undefined, { modo: 'novas', hashLinhas: ['nova', 'velha'] })
  assert.equal(r.total, 1)
  assert.deepEqual(estado(db), { nova: 'REGRA:Saúde', velha: 'IA:Outros' })
})

test('modo "tudo" refaz o automático, mas nunca o manual', async () => {
  const { db, supabase } = banco([
    linha('ia', 'Netflix.Com', 20.9, { categoria: 'Tecnologia', categoria_origem: 'IA' }),
    linha('manual', 'Netflix.Com', 20.9, { categoria: 'Serviços', categoria_origem: 'MANUAL' }),
  ])
  await categorizarTransacoes(supabase, undefined, { modo: 'tudo' })
  // A escolha manual vira memória e vence a regra (Lazer) para o mesmo lugar.
  assert.deepEqual(estado(db), { ia: 'HISTORICO:Serviços', manual: 'MANUAL:Serviços' })
})

test('memória antiga com "Outros" e marketplace genérico não decide mais nada', async () => {
  const { db, supabase } = banco(
    [linha('ml', 'Mercadolivre*Mercadol - Parcela 2/5', 40, { total_parcelas: 5, parcela_atual: 2 })],
    [
      { user_id: 'default', descricao_limpa: 'MERCADOLIVRE MERCADOL PARCELA 2 5', categoria_validada: 'Outros', frequencia: 1 },
      { user_id: 'default', descricao_limpa: 'MERCADOLIVRE MERCADOL', categoria_validada: 'Cosméticos', frequencia: 4 },
    ]
  )
  const prompts = iaPorLinha(() => ({ categoria: 'Cosméticos', confianca: 0.45 }))
  await categorizarTransacoes(supabase, 'chave')
  assert.deepEqual(estado(db), { ml: 'IA:Cosméticos' }, 'decidido pela IA, não copiado da memória')
  assert.match(prompts[0], /marketplace sem vendedor identificável/)
  assert.equal(db.tabelas.transacoes_nubank[0].classificacao_status, 'revisao_pendente')
})

test('parcela nova herda a categoria que o casal deu à parcela anterior', async () => {
  const { db, supabase } = banco([
    linha('p1', 'Donzella - Parcela 1/6', 171.59, { total_parcelas: 6, parcela_atual: 1, categoria: 'Vestuário', categoria_origem: 'MANUAL' }),
    linha('p2', 'Donzella - Parcela 2/6', 171.59, { total_parcelas: 6, parcela_atual: 2 }),
  ])
  const r = await categorizarTransacoes(supabase, undefined)
  assert.equal(r.porOrigem?.PARCELA, 1)
  assert.equal(estado(db).p2, 'PARCELA:Vestuário')
})

test('mais de 1000 linhas: lê todas as páginas', async () => {
  const muitas = Array.from({ length: 1205 }, (_, i) => linha(`u${i}`, 'Dl *Uberrides', 10 + (i % 7)))
  const { db, supabase } = banco(muitas)
  const r = await categorizarTransacoes(supabase, undefined)
  assert.equal(r.total, 1205)
  assert.equal(db.tabelas.transacoes_nubank.filter(t => t.categoria === 'Transporte').length, 1205)
})

// ─── Aprendizado pela edição ─────────────────────────────────────────────────

test('editar outro campo NÃO transforma a categoria automática em escolha manual', () => {
  assert.equal(categoriaFoiEscolhida('Outros', 'Outros'), false)
  assert.equal(origemAposEdicao('Outros', 'IA', 'Outros'), 'IA')
  assert.equal(categoriaFoiEscolhida('Outros', 'Vestuário'), true)
  assert.equal(origemAposEdicao('Outros', 'IA', 'Vestuário'), 'MANUAL')
  assert.equal(origemAposEdicao(null, null, 'Saúde'), 'MANUAL')
  assert.equal(origemAposEdicao('Saúde', 'MANUAL', ''), null)
})

test('aprendizado grava a chave do estabelecimento, ignora marketplace genérico e aceita mudança de ideia', async () => {
  const { db, supabase } = banco([])
  assert.equal(await atualizarAprendizado(supabase, 'Mercadolivre*Mercadol - Parcela 1/6', 'Cosméticos'), false)
  assert.equal(await atualizarAprendizado(supabase, 'Ifd*Comercio de Medica - Parcela 1/3', 'Saúde'), true)
  await atualizarAprendizado(supabase, 'Ifd*Comercio de Medica - Parcela 2/3', 'Saúde')
  assert.deepEqual(db.tabelas.classificacoes_aprendidas.map(a => [a.user_id, a.descricao_limpa, a.categoria_validada, a.frequencia]),
    [['default', 'comercio de medica', 'Saúde', 2]])
  await atualizarAprendizado(supabase, 'Ifd*Comercio de Medica', 'Mercado')
  assert.deepEqual(db.tabelas.classificacoes_aprendidas.map(a => [a.categoria_validada, a.frequencia]), [['Mercado', 1]])
})
