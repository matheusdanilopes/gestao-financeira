/**
 * Recuperação da resposta quando a conexão cai (sair do app no celular).
 * Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { respostaNoHistorico, aguardarResposta } from './chatRecuperacao'

const u = (content: string) => ({ role: 'user', content })
const a = (content: string) => ({ role: 'assistant', content })

test('acha a resposta da pergunta, mesmo gravada com o contexto da tela', () => {
  const historico = [
    u('Quanto gastei com iFood?'), a('R$ 1.784,51…'),
    u('Tento deixar uma margem de gastos\n\nContexto da tela:\n{"tela":"dashboard"}'), a('Sugiro R$ 2.500,00 por mês…'),
  ]
  assert.ok(respostaNoHistorico(historico, 'Tento deixar uma margem de gastos'))
})

test('pergunta gravada mas ainda sem resposta: continua esperando', () => {
  assert.ok(!respostaNoHistorico([u('Quanto gastei com iFood?'), a('R$ 1.784,51'), u('E em outubro?')], 'E em outubro?'))
  assert.ok(!respostaNoHistorico([u('Oi'), a('Olá!')], 'Pergunta que nem chegou ao servidor'))
})

test('pergunta repetida: vale a última vez em que foi feita', () => {
  const historico = [u('Tente novamente'), a('Resposta antiga'), u('Tente novamente')]
  assert.ok(!respostaNoHistorico(historico, 'Tente novamente'), 'a resposta antiga não vale para a pergunta nova')
  assert.ok(respostaNoHistorico([...historico, a('Resposta nova')], 'Tente novamente'))
})

const semEspera = { esperar: async () => {}, prazoMs: 60_000 }

test('busca até a resposta aparecer', async () => {
  let buscas = 0
  const r = await aguardarResposta(async () => {
    buscas++
    return buscas < 3 ? [u('Pergunta')] : [u('Pergunta'), a('Resposta')]
  }, 'Pergunta', () => true, semEspera)
  assert.equal(buscas, 3)
  assert.equal(r?.at(-1)?.content, 'Resposta')
})

test('falha de rede numa busca não interrompe as seguintes', async () => {
  let buscas = 0
  const r = await aguardarResposta(async () => {
    buscas++
    if (buscas === 1) throw new TypeError('Load failed')
    return [u('Pergunta'), a('Resposta')]
  }, 'Pergunta', () => true, semEspera)
  assert.ok(r)
  assert.equal(buscas, 2)
})

test('para quando o usuário cancela ou troca de conversa', async () => {
  let buscas = 0
  const r = await aguardarResposta(async () => { buscas++; return [u('Pergunta')] }, 'Pergunta', () => buscas < 2, semEspera)
  assert.equal(r, null)
  assert.equal(buscas, 2)
})

test('com o app em segundo plano não busca; busca quando volta', async () => {
  let visivel = false
  let esperas = 0
  let buscas = 0
  const r = await aguardarResposta(
    async () => { buscas++; return [u('Pergunta'), a('Resposta')] },
    'Pergunta',
    () => true,
    { prazoMs: 60_000, visivel: () => visivel, esperar: async () => { if (++esperas === 3) visivel = true } }
  )
  assert.ok(r)
  assert.equal(buscas, 1, 'nenhuma busca enquanto escondido')
})

test('desiste depois do prazo', async () => {
  const r = await aguardarResposta(async () => [u('Pergunta')], 'Pergunta', () => true, { prazoMs: 30, intervaloMs: 5 })
  assert.equal(r, null)
})
