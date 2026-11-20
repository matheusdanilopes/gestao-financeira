import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararFatura, resolverMudancaResponsavel, type PrevisaoCapturada } from '@/lib/comparacaoPrevisao'
import type { OrigemResponsavel } from '@/lib/conciliacao'

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
  ({ id, hash_linha: `h${id}`, descricao, valor, status, conciliacao_ref: null, responsavel, parcela_atual: atual, total_parcelas: total })

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

test('explica a mudança e corrige o responsável', () => {
  const origens = new Map<string, OrigemResponsavel>([
    ['h2', { tipo: 'sem_parcela_anterior', responsavelPadrao: 'Matheus' }],
  ])
  const c = compararFatura(previsao, [
    linha('1', 'Loja A - Parcela 3/10', 100, 'Matheus', 3, 10),
    linha('2', 'Loja B - Parcela 2/3', 50, 'Matheus', 2, 3),
  ], origens)

  assert.equal(c.mudancasResponsavel.length, 1)
  const m = c.mudancasResponsavel[0]
  assert.equal(m.transacaoId, '2')
  assert.equal(m.motivo.tipo, 'parcela_anterior_nao_reconhecida')
  assert.match(m.motivo.texto, /não reconheceu a parcela anterior/)

  const corrigida = resolverMudancaResponsavel(c, '2', 'corrigir')
  assert.equal(corrigida.mudancasResponsavel[0].resolucao?.acao, 'corrigida')
  assert.deepEqual(corrigida.realizado.porResponsavel, { Matheus: 100, Jeniffer: 50 })
  assert.equal(corrigida.parcelasConfirmadas, 2)

  const mantida = resolverMudancaResponsavel(c, '2', 'manter')
  assert.equal(mantida.mudancasResponsavel[0].resolucao?.responsavel, 'Matheus')
  assert.deepEqual(mantida.realizado, c.realizado)
})

test('herança de outra compra parecida', () => {
  const origens = new Map<string, OrigemResponsavel>([
    ['h2', { tipo: 'parcela_anterior_banco', responsavelPadrao: 'Matheus', referencia: { descricao: 'Loja B - Parcela 1/3', parcela: '1/3', responsavel: 'Matheus' } }],
  ])
  const c = compararFatura(previsao, [linha('2', 'Loja B - Parcela 2/3', 50, 'Matheus', 2, 3)], origens)
  assert.equal(c.mudancasResponsavel[0].motivo.tipo, 'herdou_de_outra_compra')
})
