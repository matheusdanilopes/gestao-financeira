/**
 * Loop do agente com o Gemini simulado. Cada teste é um cenário de conversa:
 * o que o modelo "responde" em cada rodada e o que o loop precisa fazer com
 * isso. Rodar: npm test
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { GeminiError } from './geminiClient'
import { simularGemini, restaurarFetch, rodarTurno, texto, chamada } from './testes/apoio'

afterEach(restaurarFetch)

const nomesFerramentas = (eventos: Array<{ type: string; nome?: string }>) =>
  eventos.filter(e => e.type === 'tool').map(e => e.nome)

// ─── Lastro ──────────────────────────────────────────────────────────────────

test('valor inventado → revisão → consulta → resposta com lastro', async () => {
  const enviados = simularGemini([
    [texto('Vocês gastaram R$ 138,50 no mercadinho.')],
    [chamada('calcular', { expressoes: ['total: 30 + 4.79'] }, 'assinatura-1')],
    [texto('Foram **R$ 34,79** no mercadinho.')],
  ])
  const { done } = await rodarTurno('Quanto gastamos no mercadinho?')

  assert.equal(done.texto, 'Foram **R$ 34,79** no mercadinho.')
  assert.deepEqual(done.meta?.revisoes, ['lastro'])
  assert.deepEqual(done.meta?.lastro.semLastro, [])
  assert.equal(done.meta?.rodadas, 3)
  assert.equal(done.meta?.uso.entrada, 300)
  assert.match(String(done.trilha[0]?.resultado), /= 34,79/)
  assert.equal(typeof done.trilha[0]?.ms, 'number')

  // A instrução de revisão citou o valor sem origem e as ferramentas continuaram disponíveis.
  assert.match(JSON.stringify(enviados[1].contents.at(-1)), /R\$ 138,50/)
  assert.ok(enviados[1].tools, 'a revisão precisa poder consultar')
})

test('valor continua sem origem depois da revisão → resposta sai com aviso', async () => {
  simularGemini([
    [texto('A maior categoria foi Saúde, com R$ 150,00.')],
    [texto('Confirmo: Saúde, com R$ 150,00.')],
  ])
  const { done } = await rodarTurno('Qual categoria mais gastei?')
  assert.match(done.texto, /^Confirmo: Saúde, com R\$ 150,00\./)
  assert.match(done.texto, /Não consegui confirmar nos dados .*R\$ 150,00/)
  assert.deepEqual(done.meta?.lastro.semLastro, ['R$ 150,00'])
  assert.deepEqual(done.meta?.revisoes, ['lastro'], 'no máximo uma revisão de lastro')
})

test('valores do snapshot e da pergunta não pedem revisão', async () => {
  simularGemini([[texto('O total do mês está em **R$ 1.000,00**; a TV de R$ 2.500,00 cabe em 10x.')]])
  const { done } = await rodarTurno('Cabe uma TV de R$ 2.500?')
  assert.deepEqual(done.meta?.revisoes, [])
  assert.equal(done.meta?.rodadas, 1)
})

test('número de uma resposta ANTERIOR do assistente não vale como fonte', async () => {
  simularGemini([
    [texto('Continua sendo R$ 138,50.')],
    [chamada('calcular', { expressoes: ['a: 100 + 36.14'] })],
    [texto('Conferi: foram **R$ 136,14**.')],
  ])
  const { done } = await rodarTurno('Leve em conta os parcelamentos', {
    historico: [
      { role: 'user', content: 'Quanto gastei no mercadinho?' },
      { role: 'assistant', content: 'Foram R$ 138,50.' },
    ],
  })
  assert.deepEqual(done.meta?.revisoes, ['lastro'])
  assert.equal(done.texto, 'Conferi: foram **R$ 136,14**.')
})

test('análise livre: percentuais e contagens não disparam revisão', async () => {
  simularGemini([[texto('Alimentação subiu 78,0% e respondeu por 3 das 5 maiores altas.')]])
  const { done } = await rodarTurno('Onde está o gargalo?')
  assert.deepEqual(done.meta?.revisoes, [])
})

// ─── Conduta ─────────────────────────────────────────────────────────────────

test('recusa sem consultar → revisão de conduta; depois, valor inventado → revisão de lastro', async () => {
  simularGemini([
    [texto('Não consigo acessar os gastos por semana, o app organiza por mês.')],
    [texto('Na semana passada foram R$ 412,00.')],
    [chamada('calcular', { expressoes: ['semana: 400 + 12.5'] })],
    [texto('Na semana passada foram **R$ 412,50**.')],
  ])
  const { done } = await rodarTurno('Quanto gastei semana passada?')
  assert.deepEqual(done.meta?.revisoes, ['conduta', 'lastro'])
  assert.equal(done.texto, 'Na semana passada foram **R$ 412,50**.')
})

test('nome interno de ferramenta na resposta → revisão de conduta', async () => {
  simularGemini([
    [texto('Usei consultar_transacoes e não achei nada.')],
    [texto('Não encontrei compras nesse período.')],
  ])
  const { done } = await rodarTurno('Comprei algo ontem?')
  assert.deepEqual(done.meta?.revisoes, ['conduta'])
  assert.equal(done.texto, 'Não encontrei compras nesse período.')
})

// ─── Mecânica do loop ────────────────────────────────────────────────────────

test('preâmbulo antes de uma consulta é descartado da tela', async () => {
  simularGemini([
    [texto('Vou verificar os seus dados agora mesmo…'), chamada('listar_dimensoes')],
    [texto('Pronto.')],
  ])
  const { eventos, done } = await rodarTurno('O que vocês têm?')
  const iReset = eventos.findIndex(e => e.type === 'reset')
  const iTool = eventos.findIndex(e => e.type === 'tool')
  assert.ok(iReset >= 0 && iReset < iTool, 'reset antes da ferramenta')
  assert.ok(eventos.some(e => e.type === 'status' && e.texto.startsWith('Vou verificar')))
  assert.equal(done.texto, 'Pronto.')
})

test('cadeia de consultas em várias rodadas', async () => {
  simularGemini([
    [chamada('listar_dimensoes')],
    [chamada('consultar_transacoes', { mesInicio: '2026-10', mesFim: '2026-10' })],
    [chamada('calcular', { expressoes: ['x: 1 + 1'] })],
    [texto('Analisei tudo.')],
  ])
  const { eventos, done } = await rodarTurno('Analise outubro')
  assert.deepEqual(nomesFerramentas(eventos), ['listar_dimensoes', 'consultar_transacoes', 'calcular'])
  assert.deepEqual(done.ferramentas, ['listar_dimensoes', 'consultar_transacoes', 'calcular'])
  assert.equal(done.trilha.length, 3)
})

test('chamadas paralelas: assinatura volta só onde veio e respostas vão como "user"', async () => {
  const enviados = simularGemini([
    [chamada('listar_dimensoes', {}, 'sig-A'), chamada('calcular', { expressoes: ['y: 2 * 3'] })],
    [texto('Ok.')],
  ])
  await rodarTurno('Pergunta')
  const conteudos = enviados[1].contents
  const doModelo = conteudos.find(c => c.role === 'model')!
  assert.equal(doModelo.parts[0].thoughtSignature, 'sig-A')
  assert.equal(doModelo.parts[1].thoughtSignature, undefined)
  const respostas = conteudos.at(-1)!
  assert.equal(respostas.role, 'user')
  assert.equal(respostas.parts.length, 2)
  assert.ok(respostas.parts.every(p => p.functionResponse))
})

test('assinatura que chega em pedaços do stream é preservada', async () => {
  const enviados = simularGemini([
    { pedacos: [[texto('')], [chamada('listar_dimensoes', {}, 'sig-stream')]] },
    [texto('Ok.')],
  ])
  await rodarTurno('Pergunta')
  const doModelo = enviados[1].contents.find(c => c.role === 'model')!
  assert.equal(doModelo.parts[0].thoughtSignature, 'sig-stream')
})

test('mais de 5 chamadas numa rodada: só as 5 primeiras são executadas', async () => {
  simularGemini([
    Array.from({ length: 7 }, (_, i) => chamada('calcular', { expressoes: [`c${i}: ${i} + 1`] })),
    [texto('Ok.')],
  ])
  const { eventos } = await rodarTurno('Muitas contas')
  assert.equal(nomesFerramentas(eventos).length, 5)
})

test('ferramenta inexistente não derruba o turno', async () => {
  const enviados = simularGemini([[chamada('ferramenta_magica')], [texto('Tudo certo.')]])
  const { done } = await rodarTurno('Pergunta')
  assert.equal(done.texto, 'Tudo certo.')
  assert.match(JSON.stringify(enviados[1].contents.at(-1)), /não existe/)
})

test('modelo que só pede ferramentas: última rodada sem ferramentas e resposta honesta', async () => {
  const enviados = simularGemini([[chamada('listar_dimensoes')]])
  const { done } = await rodarTurno('Pergunta')
  assert.match(done.texto, /Não consegui formular a resposta/)
  const ultima = enviados.at(-1)! as unknown as { tools?: unknown; toolConfig?: { functionCallingConfig: { mode: string } } }
  assert.ok(ultima.tools, 'continuam declaradas (a conversa já tem chamadas a elas)')
  assert.equal(ultima.toolConfig?.functionCallingConfig.mode, 'NONE', 'mas proibidas na rodada final')
})

test('resposta vazia → nova tentativa sem stream', async () => {
  const enviados = simularGemini([[texto('')], [texto('Agora sim.')]])
  const { done } = await rodarTurno('Oi')
  assert.equal(done.texto, 'Agora sim.')
  assert.match(enviados[1].url, /:generateContent/)
})

test('resposta cortada por tamanho recebe aviso', async () => {
  simularGemini([{ pedacos: [[texto('Resposta longa…')]], finishReason: 'MAX_TOKENS' }])
  const { done } = await rodarTurno('Detalhe tudo')
  assert.match(done.texto, /resposta truncada por tamanho/)
})

test('sem tempo: não revisa, mas avisa do valor sem origem', async () => {
  const enviados = simularGemini([[texto('Foram R$ 999,99.')]])
  const { done } = await rodarTurno('Quanto?', { deadlineMs: Date.now() + 5_000 })
  assert.equal(enviados.length, 1)
  assert.match(done.texto, /Não consegui confirmar/)
})

test('dados bloqueados pela auditoria: sem ferramentas e sem revisão', async () => {
  const enviados = simularGemini([[texto('Encontrei inconsistências; revise a importação.')]])
  const { done } = await rodarTurno('Quanto gastei?', { semFerramentas: true })
  assert.equal(enviados[0].tools, undefined)
  assert.deepEqual(done.meta?.revisoes, [])
})

// ─── Configuração do modelo e erros ──────────────────────────────────────────

test('Gemini 3.8 Flash: raciocínio low (latência), sem temperatura, com ferramentas em AUTO', async () => {
  const enviados = simularGemini([[texto('Oi!')]])
  await rodarTurno('Oi')
  const corpo = enviados[0] as unknown as Record<string, unknown>
  assert.match(enviados[0].url, /models\/gemini-3\.8-flash:streamGenerateContent/)
  assert.deepEqual(enviados[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' })
  assert.equal(enviados[0].generationConfig.temperature, undefined)
  assert.equal(enviados[0].generationConfig.maxOutputTokens, 16384)
  assert.deepEqual(corpo.toolConfig, { functionCallingConfig: { mode: 'AUTO' } })
})

test('cota estourada vira GeminiError QUOTA (sem retentar)', async () => {
  const enviados = simularGemini([{ status: 429, corpo: '{"error":{"details":[{"retryDelay": "7s"}]}}' }])
  await assert.rejects(
    rodarTurno('Oi'),
    (e: unknown) => e instanceof GeminiError && e.codigo === 'QUOTA' && e.detalhes?.segundos === 7
  )
  assert.equal(enviados.length, 1)
})

test('chave ou modelo inválido vira CONFIG', async () => {
  simularGemini([{ status: 404, corpo: 'model not found' }])
  await assert.rejects(rodarTurno('Oi'), (e: unknown) => e instanceof GeminiError && e.codigo === 'CONFIG')
})

test('instabilidade (503) é retentada e o turno segue', async () => {
  const enviados = simularGemini([{ status: 503 }, [texto('Voltei.')]])
  const { done } = await rodarTurno('Oi')
  assert.equal(done.texto, 'Voltei.')
  assert.equal(enviados.length, 2)
})
