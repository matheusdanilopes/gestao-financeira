/**
 * Prompt do Fin, configuração do Gemini por modelo e leitura de gráficos.
 * Rodar: npm test
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, promptComoEvidencia } from './systemPrompt'
import { construirReferencias } from './queryEngine'
import { computeInsights } from '../insightsEngine'
import { gerarRodada, resumirConversa, GEMINI_MODEL_LEGADO } from './geminiClient'
import { criarInterlocutor } from './interlocutor'
import { ehLinguagemGrafico, lerGrafico, substituirGraficosPorTexto } from '../../graficoChat'
import { simularGemini, restaurarFetch, dadosVazios, HOJE_TESTE, texto } from './testes/apoio'
import type { ValidationCertificate } from '../types'

afterEach(restaurarFetch)

// ─── Prompt ──────────────────────────────────────────────────────────────────

const certificado: ValidationCertificate = {
  timestamp: '', indiceConfiabilidade: 100, totalTransacoes: 0, transacoesValidadas: 0,
  transacoesExcluidas: 0, problemas: [], certificado: true, resumo: '',
}

function prompt(canal: 'app' | 'telegram' = 'app', resumoConversa?: string) {
  const data = dadosVazios()
  return buildSystemPrompt({
    resumoConversa,
    data,
    metrics: computeInsights(data, HOJE_TESTE),
    refs: construirReferencias(HOJE_TESTE),
    certificate: certificado,
    interlocutor: criarInterlocutor('jeniffer@financeiro.com', canal),
  })
}

test('prompt traz princípios e exemplos, sem a lista de regras inegociáveis', () => {
  const p = prompt()
  assert.match(p, /COMO ANALISAR/)
  assert.match(p, /Explore com liberdade/)
  assert.match(p, /EXEMPLOS DE BOM RACIOCÍNIO/)
  assert.doesNotMatch(p, /inegoci/i)
  assert.doesNotMatch(p, /use direto, sem consultar/)
})

test('exemplos não trazem valores em R$ (não podem virar "evidência")', () => {
  const p = prompt()
  const exemplos = p.slice(p.indexOf('EXEMPLOS DE BOM RACIOCÍNIO'), p.indexOf('SNAPSHOT DO MOMENTO'))
  assert.ok(exemplos.length > 200)
  assert.doesNotMatch(exemplos, /R\$\s*\d/)
})

test('formato do gráfico no app: abertura do bloco sozinha na linha', () => {
  const p = prompt()
  assert.match(p, /\n\s*```grafico\n\s*\{"tipo"/)
  assert.doesNotMatch(p, /```grafico com JSON/)
})

test('no Telegram não há instrução de gráfico nem de tabela', () => {
  const p = prompt('telegram')
  assert.doesNotMatch(p, /```grafico/)
  assert.match(p, /Telegram/)
})

test('resumo da conversa (com números antigos) não vale como evidência', () => {
  const p = prompt('app', '[RESUMO n=12] O assistente disse que Saúde somou R$ 150,00.')
  assert.match(p, /R\$ 150,00/)
  const ev = promptComoEvidencia(p)
  assert.doesNotMatch(ev, /R\$ 150,00/)
  assert.match(ev, /COMO RESPONDER/, 'o resto do prompt continua')
  assert.match(ev, /SNAPSHOT DO MOMENTO/)
})

test('prompt continua enxuto', () => {
  // Referência: 19,2 mil caracteres antes da reescrita; 16 mil depois, já com os exemplos.
  assert.ok(prompt().length < 18_000, `prompt com ${prompt().length} caracteres`)
})

// ─── Configuração por modelo ─────────────────────────────────────────────────

test('modelo legado mantém orçamento em tokens e temperatura', async () => {
  const enviados = simularGemini([[texto('ok')]])
  await gerarRodada({
    apiKey: 'x', deadlineMs: Date.now() + 10_000, modelo: GEMINI_MODEL_LEGADO, thinkingBudget: 512,
    contents: [{ role: 'user', parts: [{ text: 'oi' }] }],
  })
  assert.match(enviados[0].url, /gemini-2\.5-flash:generateContent/)
  assert.deepEqual(enviados[0].generationConfig.thinkingConfig, { thinkingBudget: 512 })
  assert.equal(enviados[0].generationConfig.temperature, 0.2)
})

test('tarefas mecânicas (resumo) usam raciocínio mínimo no Gemini 3', async () => {
  const enviados = simularGemini([[texto('Resumo curto.')]])
  const r = await resumirConversa('x', [{ role: 'user', content: 'oi' }], Date.now() + 10_000)
  assert.equal(r, 'Resumo curto.')
  assert.deepEqual(enviados[0].generationConfig.thinkingConfig, { thinkingLevel: 'minimal' })
  assert.equal(enviados[0].generationConfig.maxOutputTokens, 1000)
})

test('JSON estruturado continua com responseMimeType no Gemini 3', async () => {
  const enviados = simularGemini([[texto('{}')]])
  await gerarRodada({
    apiKey: 'x', deadlineMs: Date.now() + 10_000, responseMimeType: 'application/json', thinkingBudget: 20_000,
    contents: [{ role: 'user', parts: [{ text: 'oi' }] }],
  })
  assert.equal(enviados[0].generationConfig.responseMimeType, 'application/json')
  assert.deepEqual(enviados[0].generationConfig.thinkingConfig, { thinkingLevel: 'high' })
})

// ─── Gráficos ────────────────────────────────────────────────────────────────

// A resposta real de 03/11/2026 que apareceu como código cru.
const GRAFICO_REAL =
  '{"tipo":"barra_horizontal","titulo":"Variação de Gastos por Categoria (Out/26 vs Set/26)","unidade":"brl",' +
  '"rotulos":["Alimentação","Mercado","Lazer"],"series":[{"nome":"Outubro","valores":[2689.86,880.67,1059.11]},' +
  '{"nome":"Setembro","valores":[1519.52,278.53,677.80]}]}'

test('cabeçalho do bloco de gráfico tolera texto depois da linguagem', () => {
  assert.ok(ehLinguagemGrafico('grafico'))
  assert.ok(ehLinguagemGrafico('grafico com JSON numa linha só:'))
  assert.ok(ehLinguagemGrafico(' Grafico '))
  assert.ok(!ehLinguagemGrafico('json'))
  assert.ok(lerGrafico(GRAFICO_REAL))
})

test('Telegram converte o gráfico em texto mesmo com cabeçalho torto', () => {
  const md = 'Leitura principal.\n```grafico com JSON numa linha só:\n' + GRAFICO_REAL + '\n```\nFim.'
  const t = substituirGraficosPorTexto(md)
  assert.doesNotMatch(t, /```/)
  assert.match(t, /Alimentação/)
})
