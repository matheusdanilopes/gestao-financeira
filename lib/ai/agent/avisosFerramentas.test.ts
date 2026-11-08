/**
 * Avisos "na hora certa" devolvidos pelas ferramentas. Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararPeriodos, construirReferencias } from './queryEngine'
import { mesmoPayload } from './writeEngine'
import type { EnrichedData } from '../types'

const refs = construirReferencias(new Date(2026, 10, 3))

// Fatura de OUT/26 = projeto_fatura 2026-11; SET/26 = 2026-10.
const tx = (cartao: string, valor: number, projeto: string) => ({
  id: `${cartao}-${valor}-${projeto}`, data: `${projeto.slice(0, 7)}-01`, descricao: 'Loja', valor,
  responsavel: 'Matheus', projeto_fatura: `${projeto}-01`, cartao, categoria: 'Outros',
})
const data = {
  transacoes: [
    tx('nubank', 100, '2026-11'), tx('cartao1', 40, '2026-11'),
    tx('nubank', 80, '2026-10'), tx('cartao1', 30, '2026-10'),
  ],
  planejamento: [
    { id: 'p1', item: 'Aluguel', valor_previsto: 1000, mes_referencia: '2026-10-01', responsavel: 'Conjunto', categoria: 'Moradia' },
    { id: 'p2', item: 'Aluguel', valor_previsto: 1000, mes_referencia: '2026-09-01', responsavel: 'Conjunto', categoria: 'Moradia' },
  ],
  assinaturas: [], receitas: [], investimentos: [], aportes: [], configuracoes: [], faturas: [],
} as unknown as EnrichedData

const base = { periodoAInicio: '2026-10', periodoAFim: '2026-10', periodoBInicio: '2026-09', periodoBFim: '2026-09', dimensao: 'total' as const, incluirContasFixas: true }

test('excluirCartao tira o cartão e mantém as contas fixas ("desconsidere o PicPay")', () => {
  const r = compararPeriodos(data, { ...base, excluirCartao: 'cartao1' }, refs)
  assert.match(r, /cartão \+ contas fixas/)
  assert.match(r, /Total A: R\$\s1\.100,00 \| Total B: R\$\s1\.080,00/)
})

test('filtro de um cartão avisa que as contas fixas ficaram de fora', () => {
  const r = compararPeriodos(data, { ...base, cartao: 'nubank' }, refs)
  assert.match(r, /contas fixas NÃO entraram/)
  assert.match(r, /excluirCartao/)
  assert.match(r, /Total A: R\$\s100,00/)
})

test('mesmoPayload ignora a ordem das chaves', () => {
  assert.ok(mesmoPayload({ nome: 'sabonete íntimo', quantidade: 1 }, { quantidade: 1, nome: 'sabonete íntimo' }))
  assert.ok(!mesmoPayload({ nome: 'desodorante Mateus', quantidade: 1 }, { nome: 'desodorante Jennifer', quantidade: 1 }))
})
