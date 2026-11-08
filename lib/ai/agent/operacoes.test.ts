/**
 * Operações de escrita pelo chat (propor → confirmar), com Supabase em
 * memória e o Gemini simulado. Os cenários reproduzem a conversa real de
 * 10/10/2026 no Telegram (lista de mercado). Rodar: npm test
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { simularGemini, restaurarFetch, rodarTurno, texto, chamada, criarSupabaseFalso, dadosVazios } from './testes/apoio'
import type { ContextoEscrita } from './writeEngine'

afterEach(restaurarFetch)

const pendente = (nome: string) => ({
  id: `op-${nome}`, conversation_id: 'conv-1', tipo: 'item_mercado', status: 'pendente',
  payload: { nome, quantidade: 1 }, resumo: `Adicionar à lista de mercado: "${nome}"`,
  created_at: '2026-10-10T16:20:40Z',
})

const comSabonete = dadosVazios({ mercado: [{ nome: 'Sabonete', quantidade: 1, comprado: false }] })

function escritaCom(db: ReturnType<typeof criarSupabaseFalso>): Partial<ContextoEscrita> {
  return { supabase: db.cliente as unknown as ContextoEscrita['supabase'] }
}

test('"Sim, pode confirmar" após aviso de duplicidade: não recria a proposta e confirma', async () => {
  const db = criarSupabaseFalso({ chat_operacoes: [pendente('sabonete íntimo')] })
  simularGemini([
    // O erro real: em vez de confirmar, o modelo propôs de novo.
    [chamada('propor_item_lista_mercado', { nome: 'sabonete íntimo' })],
    [chamada('confirmar_operacao')],
    [texto('Prontinho, incluí o sabonete íntimo na lista.')],
  ])
  const { done } = await rodarTurno('Sim, pode confirmar.', { dados: comSabonete, escrita: escritaCom(db) })

  assert.match(String(done.trilha[0].resultado), /JÁ ESTÁ PENDENTE/)
  assert.match(String(done.trilha[1].resultado), /^CONFIRMADO E GRAVADO/)
  assert.equal(db.tabelas.lista_mercado_itens?.length, 1)
  assert.equal(db.tabelas.lista_mercado_itens[0].nome, 'sabonete íntimo')
  assert.deepEqual(db.tabelas.chat_operacoes.map(o => o.status), ['confirmada'], 'nenhuma proposta nova foi criada')
})

test('proposta nova substitui a pendente de uma mensagem anterior — e o modelo é avisado', async () => {
  const db = criarSupabaseFalso({ chat_operacoes: [pendente('desodorante Mateus')] })
  simularGemini([
    [chamada('propor_item_lista_mercado', { nome: 'desodorante Jennifer' })],
    [texto('Troquei pelo desodorante Jennifer. Quer os dois?')],
  ])
  const { done } = await rodarTurno('Inclua desodorante Jennifer.', { escrita: escritaCom(db) })

  assert.match(String(done.trilha[0].resultado), /desodorante Mateus.*DESCARTADA/)
  assert.match(String(done.trilha[0].resultado), /queria as duas/)
  const status = Object.fromEntries(db.tabelas.chat_operacoes.map(o => [(o.payload as { nome: string }).nome, o.status]))
  assert.deepEqual(status, { 'desodorante Mateus': 'cancelada', 'desodorante Jennifer': 'pendente' })
})

test('dois itens na mesma resposta viram um lote, sem aviso de descarte', async () => {
  const db = criarSupabaseFalso()
  simularGemini([
    [chamada('propor_item_lista_mercado', { nome: 'arroz' })],
    [chamada('propor_item_lista_mercado', { nome: 'feijão' })],
    [texto('Preparei arroz e feijão. Confirma?')],
  ])
  const { done } = await rodarTurno('Coloca arroz e feijão na lista', { escrita: escritaCom(db) })

  assert.doesNotMatch(String(done.trilha[1].resultado), /DESCARTADA/)
  const pendentes = db.tabelas.chat_operacoes.filter(o => o.status === 'pendente')
  assert.equal(pendentes.length, 1)
  assert.equal(pendentes[0].tipo, 'lote')
})

test('propor e confirmar na mesma resposta é bloqueado; nada é gravado', async () => {
  const db = criarSupabaseFalso()
  simularGemini([
    [chamada('propor_item_lista_mercado', { nome: 'café' }), chamada('confirmar_operacao')],
    [texto('Preparei o café. Confirma?')],
  ])
  const { done } = await rodarTurno('Coloca café', { escrita: escritaCom(db) })
  assert.match(String(done.trilha[1].resultado), /^BLOQUEADO/)
  assert.equal(db.tabelas.lista_mercado_itens, undefined)
  assert.equal(db.tabelas.chat_operacoes[0].status, 'pendente')
})

test('confirmar sem nada pendente não grava e orienta a propor', async () => {
  const db = criarSupabaseFalso()
  simularGemini([[chamada('confirmar_operacao')], [texto('Não havia nada para confirmar. O que você quer incluir?')]])
  const { done } = await rodarTurno('Sim', { escrita: escritaCom(db) })
  assert.match(String(done.trilha[0].resultado), /NENHUMA OPERAÇÃO PENDENTE/)
  assert.equal(db.tabelas.lista_mercado_itens, undefined)
})

test('"não" cancela a pendente', async () => {
  const db = criarSupabaseFalso({ chat_operacoes: [pendente('leite')] })
  simularGemini([[chamada('cancelar_operacao')], [texto('Cancelado.')]])
  await rodarTurno('Não, deixa pra lá', { escrita: escritaCom(db) })
  assert.equal(db.tabelas.chat_operacoes[0].status, 'cancelada')
  assert.equal(db.tabelas.lista_mercado_itens, undefined)
})

test('confirmação gravada vira registro de atividade (auditoria)', async () => {
  const db = criarSupabaseFalso({ chat_operacoes: [pendente('pão')] })
  simularGemini([[chamada('confirmar_operacao')], [texto('Incluí o pão.')]])
  await rodarTurno('Pode', { escrita: escritaCom(db) })
  assert.equal(db.tabelas.activity_logs?.length, 1)
  assert.match(String(db.tabelas.activity_logs[0].descricao), /^IA: .*pão/)
})
