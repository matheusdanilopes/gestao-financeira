import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararFatura, type PrevisaoCapturada } from '@/lib/comparacaoPrevisao'

const previsao: PrevisaoCapturada = {
  fatura: '2026-12-01',
  cartao: 'nubank',
  faturaBase: '2026-11-01',
  itens: [
    { descricao: 'Loja A - Parcela 2/10', valor: 100, responsavel: 'Matheus', categoria: 'x', cartao: 'nubank', parcelaAtual: 3, totalParcelas: 10 },
    { descricao: 'Loja B - Parcela 1/3', valor: 50, responsavel: 'Jeniffer', categoria: 'x', cartao: 'nubank', parcelaAtual: 2, totalParcelas: 3 },
    { descricao: 'Loja C - Parcela 4/5', valor: 30, responsavel: 'Matheus', categoria: 'x', cartao: 'nubank', parcelaAtual: 5, totalParcelas: 5 },
  ],
}

const linha = (id: string, descricao: string, valor: number, responsavel: string, atual: number | null, total: number | null, status = 'PENDENTE') =>
  ({ id, descricao, valor, status, conciliacao_ref: null, responsavel, parcela_atual: atual, total_parcelas: total })

test('compara previsão com a fatura importada', () => {
  const c = compararFatura(previsao, [
    linha('1', 'Loja A - Parcela 3/10', 100, 'Matheus', 3, 10),
    linha('2', 'Loja B - Parcela 2/3', 52, 'Matheus', 2, 3),
    linha('3', 'Mercado', 200, 'Jeniffer', null, null),
  ])

  assert.equal(c.previsto.total, 180)
  assert.deepEqual(c.previsto.porResponsavel, { Matheus: 130, Jeniffer: 50 })
  assert.equal(c.realizado.total, 352)
  assert.deepEqual(c.realizado.porResponsavel, { Matheus: 152, Jeniffer: 200 })
  assert.equal(c.parcelasConfirmadas, 1)
  assert.deepEqual(c.mudancasResponsavel.map(m => [m.de, m.para]), [['Jeniffer', 'Matheus']])
  assert.deepEqual(c.mudancasValor.map(m => [m.previsto, m.realizado]), [[50, 52]])
  assert.deepEqual(c.parcelasNaoVieram.map(m => m.parcela), ['5/5'])
  assert.equal(c.foraDaPrevisao.quantidade, 1)
  assert.deepEqual(c.foraDaPrevisao.porResponsavel, { Jeniffer: 200 })
  assert.equal(c.parcelasRealizadas.total, 152)
})
