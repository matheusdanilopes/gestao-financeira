import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumirAtividadeRecente, type TransacaoRecenteRow } from './atividadeRecente'

const hoje = new Date('2026-11-21T15:00:00')
const t = (data: string, valor: number, responsavel: string, extra: Partial<TransacaoRecenteRow> = {}): TransacaoRecenteRow => ({
  data_compra: data, valor, responsavel, descricao: 'Compra', status: null, parcela_atual: null, total_parcelas: null, ...extra,
})

test('soma os últimos 3 dias por pessoa, ordenado pelo maior gasto', () => {
  const r = resumirAtividadeRecente([
    t('2026-11-21', 50, 'Matheus'),
    t('2026-11-19', 30, 'Matheus'),
    t('2026-11-20', 100, 'Jeniffer'),
    t('2026-11-18', 999, 'Matheus'), // fora da janela de 3 dias
  ], hoje)
  assert.equal(r.totalJanela, 180)
  assert.equal(r.comprasJanela, 3)
  assert.deepEqual(r.porPessoa.map(p => [p.responsavel, p.total, p.compras]), [['Jeniffer', 100, 1], ['Matheus', 80, 2]])
})

test('ignora estornos, créditos e parcelas 2+ (a data é a da compra original)', () => {
  const r = resumirAtividadeRecente([
    t('2026-11-21', 40, 'Matheus', { status: 'ESTORNADO' }),
    t('2026-11-21', -20, 'Matheus'),
    t('2026-11-21', 70, 'Matheus', { parcela_atual: 2, total_parcelas: 5 }),
    t('2026-11-21', 25, 'Matheus', { descricao: 'Loja - Parcela 1/3' }),
  ], hoje)
  assert.equal(r.totalJanela, 25)
})

test('maior compra e comparação semana x semana anterior', () => {
  const r = resumirAtividadeRecente([
    t('2026-11-15', 300, 'Jeniffer', { descricao: 'Mercado' }),
    t('2026-11-20', 50, 'Matheus'),
    t('2026-11-10', 100, 'Matheus'),
    t('2026-11-14', 400, 'Matheus'), // 7 dias atrás: semana anterior
  ], hoje)
  assert.equal(r.maiorCompraSemana?.descricao, 'Mercado')
  assert.equal(r.totalSemana, 350)
  assert.equal(r.totalSemanaAnterior, 500)
  assert.equal(r.mediaDiariaAnterior, (300 + 100 + 400) / 27)
})
