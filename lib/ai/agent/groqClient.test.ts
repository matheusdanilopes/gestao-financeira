/**
 * Contingência no Groq: tradução do formato do Gemini e troca de provedor
 * quando o Gemini falha. Nada aqui toca a rede. Rodar: npm test
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { gerarRodada, gerarStream, transcreverAudio, GeminiError, type PedacoStream } from './geminiClient'
import { converterEsquema, converterMensagens } from './groqClient'
import type { FunctionDeclaration } from './tools'

const fetchOriginal = globalThis.fetch
const chaveOriginal = process.env.GROQ_API_KEY

interface Chamada { url: string; corpo: unknown }

/** Responde por provedor: `gemini` e `groq` recebem a lista de respostas em ordem. */
function simular(respostas: { gemini: Response[]; groq?: Response[] }): Chamada[] {
  const chamadas: Chamada[] = []
  const filas = { gemini: [...respostas.gemini], groq: [...(respostas.groq ?? [])] }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    chamadas.push({ url: u, corpo })
    const fila = u.includes('api.groq.com') ? filas.groq : filas.gemini
    const r = fila.shift()
    if (!r) throw new Error(`resposta não simulada para ${u}`)
    return r
  }) as typeof fetch
  return chamadas
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status })
const semCreditos = () => new Response('{"error":{"code":402,"message":"credits are depleted"}}', { status: 402 })
const groqTexto = (content: string) =>
  json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } })

beforeEach(() => { process.env.GROQ_API_KEY = 'gsk_teste' })
afterEach(() => {
  globalThis.fetch = fetchOriginal
  if (chaveOriginal === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = chaveOriginal
})

const base = { apiKey: 'k', deadlineMs: Date.now() + 60_000 }
const prazo = () => ({ ...base, deadlineMs: Date.now() + 60_000 })

// ─── Tradução ────────────────────────────────────────────────────────────────

test('esquema do Gemini vira JSON Schema (tipos minúsculos, nullable)', () => {
  const r = converterEsquema({
    type: 'OBJECT',
    properties: { a: { type: 'STRING', enum: ['x'] }, b: { type: 'NUMBER', nullable: true }, c: { type: 'ARRAY', items: { type: 'INTEGER' } } },
    required: ['a'],
  })
  assert.deepEqual(r, {
    type: 'object',
    properties: { a: { type: 'string', enum: ['x'] }, b: { type: ['number', 'null'] }, c: { type: 'array', items: { type: 'integer' } } },
    required: ['a'],
  })
})

test('conversa com ferramentas: cada resposta casa com o id da sua chamada', () => {
  const { mensagens } = converterMensagens({
    ...base,
    systemInstruction: 'sistema',
    contents: [
      { role: 'user', parts: [{ text: 'quanto gastei?' }] },
      { role: 'model', parts: [
        { functionCall: { name: 'consultar_transacoes', args: { mesInicio: '2026-10' } }, thoughtSignature: 'abc' },
        { functionCall: { name: 'resumo_mensal', args: {} } },
      ] },
      { role: 'user', parts: [
        { functionResponse: { name: 'resumo_mensal', response: { name: 'resumo_mensal', content: 'R2' } } },
        { functionResponse: { name: 'consultar_transacoes', response: { name: 'consultar_transacoes', content: 'R1' } } },
      ] },
    ],
  })
  assert.deepEqual(mensagens[0], { role: 'system', content: 'sistema' })
  assert.deepEqual(mensagens[1], { role: 'user', content: 'quanto gastei?' })
  const assistente = mensagens[2] as { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> }
  assert.equal(assistente.tool_calls.length, 2)
  assert.equal(assistente.tool_calls[0].function.arguments, '{"mesInicio":"2026-10"}')
  const idDe = (nome: string) => assistente.tool_calls.find(t => t.function.name === nome)!.id
  assert.deepEqual(mensagens[3], { role: 'tool', tool_call_id: idDe('resumo_mensal'), content: 'R2' })
  assert.deepEqual(mensagens[4], { role: 'tool', tool_call_id: idDe('consultar_transacoes'), content: 'R1' })
})

test('imagem vira image_url e pedido JSON leva o esquema no prompt de sistema', () => {
  const { mensagens, temImagem } = converterMensagens({
    ...base,
    responseMimeType: 'application/json',
    responseSchema: { type: 'OBJECT', properties: { preco: { type: 'NUMBER' } } },
    contents: [{ role: 'user', parts: [{ text: 'leia' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }] }],
  })
  assert.equal(temImagem, true)
  assert.match((mensagens[0] as { content: string }).content, /"type":"number"/)
  assert.deepEqual((mensagens[1] as { content: unknown }).content, [
    { type: 'text', text: 'leia' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
  ])
})

// ─── Troca de provedor ───────────────────────────────────────────────────────

test('Gemini sem créditos → resposta vem do Groq', async () => {
  const chamadas = simular({ gemini: [semCreditos()], groq: [groqTexto('<think>x</think>Olá pelo Groq')] })
  const r = await gerarRodada({ ...prazo(), contents: [{ role: 'user', parts: [{ text: 'oi' }] }] })
  assert.equal(r.texto, 'Olá pelo Groq')
  assert.match(r.modelo ?? '', /^groq:/)
  assert.deepEqual(r.uso, { entrada: 50, saida: 5, raciocinio: 0 })
  assert.equal(chamadas.length, 2)
})

test('Groq também fora → propaga o erro ORIGINAL do Gemini', async () => {
  simular({ gemini: [semCreditos()], groq: [json({ error: 'bad' }, 400)] })
  await assert.rejects(
    gerarRodada({ ...prazo(), contents: [{ role: 'user', parts: [{ text: 'oi' }] }] }),
    (e: unknown) => e instanceof GeminiError && e.codigo === 'CREDITOS'
  )
})

test('sem GROQ_API_KEY a contingência não é tentada', async () => {
  delete process.env.GROQ_API_KEY
  const chamadas = simular({ gemini: [semCreditos()] })
  await assert.rejects(gerarRodada({ ...prazo(), contents: [{ role: 'user', parts: [{ text: 'oi' }] }] }), GeminiError)
  assert.equal(chamadas.length, 1)
})

test('modelo aposentado no Groq → tenta o próximo candidato', async () => {
  const chamadas = simular({
    gemini: [semCreditos()],
    groq: [json({ error: { code: 'model_decommissioned' } }, 400), groqTexto('ok')],
  })
  const r = await gerarRodada({ ...prazo(), contents: [{ role: 'user', parts: [{ text: 'oi' }] }] })
  assert.equal(r.texto, 'ok')
  const modelos = chamadas.filter(c => c.url.includes('groq')).map(c => (c.corpo as { model: string }).model)
  assert.equal(modelos.length, 2)
  assert.notEqual(modelos[0], modelos[1])
})

test('stream com ferramentas: Gemini fora → chamadas vêm do Groq e ferramentas são traduzidas', async () => {
  const tools: FunctionDeclaration[] = [{
    name: 'resumo_mensal', description: 'resumo', parameters: { type: 'OBJECT', properties: { mes: { type: 'STRING' } } },
  }]
  const chamadas = simular({
    gemini: [semCreditos()],
    groq: [json({
      choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'resumo_mensal', arguments: '{"mes":"2026-10"}' } }] }, finish_reason: 'tool_calls' }],
    })],
  })
  const pedacos: PedacoStream[] = []
  for await (const p of gerarStream({ ...prazo(), tools, modoFerramentas: 'AUTO', contents: [{ role: 'user', parts: [{ text: 'resumo' }] }] })) {
    pedacos.push(p)
  }
  assert.deepEqual(pedacos[0], { tipo: 'chamadas', chamadas: [{ name: 'resumo_mensal', args: { mes: '2026-10' } }] })
  assert.equal(pedacos.at(-1)?.tipo, 'fim')
  assert.match(pedacos.at(-1)?.modelo ?? '', /^groq:/)
  const corpo = chamadas[1].corpo as { tools: Array<{ function: { parameters: { type: string } } }>; tool_choice: string }
  assert.equal(corpo.tools[0].function.parameters.type, 'object')
  assert.equal(corpo.tool_choice, 'auto')
})

test('rodada do Groq volta ao Gemini 3 com assinatura externa na chamada de ferramenta', async () => {
  const chamadas = simular({
    gemini: [json({ candidates: [{ content: { parts: [{ text: 'pronto' }] }, finishReason: 'STOP' }] })],
  })
  await gerarRodada({
    ...prazo(),
    modelo: 'gemini-3.8-flash',
    contents: [
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ functionCall: { name: 'a', args: {} } }, { functionCall: { name: 'b', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'a', response: {} } }, { functionResponse: { name: 'b', response: {} } }] },
    ],
  })
  const enviado = chamadas[0].corpo as { contents: Array<{ parts: Array<{ thoughtSignature?: string }> }> }
  assert.equal(enviado.contents[1].parts[0].thoughtSignature, 'skip_thought_signature_validator')
  assert.equal(enviado.contents[1].parts[1].thoughtSignature, undefined)
})

test('transcrição: Gemini fora → Whisper do Groq', async () => {
  const chamadas = simular({ gemini: [semCreditos()], groq: [json({ text: ' gastei 50 reais no mercado ' })] })
  const r = await transcreverAudio('k', Buffer.from('audio').toString('base64'), 'audio/ogg', Date.now() + 60_000)
  assert.equal(r, 'gastei 50 reais no mercado')
  assert.match(chamadas[1].url, /audio\/transcriptions$/)
  assert.ok(chamadas[1].corpo instanceof FormData)
})
