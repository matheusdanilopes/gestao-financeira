import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extrairFaturaDoArquivo, aplicarFaturaDoArquivo } from '@/lib/faturaArquivo'
import type { TransacaoNubank } from '@/lib/csvparser'

function t(data_compra: string, projeto_fatura: string): TransacaoNubank {
  return {
    data_compra, projeto_fatura, descricao: 'x', valor: 1, responsavel: 'Matheus', hash_linha: data_compra,
    parcela_atual: null, total_parcelas: null, is_estorno: false,
  }
}

test('lê a fatura do nome do arquivo do NuBank ou de um valor explícito', () => {
  assert.equal(extrairFaturaDoArquivo('Nubank_2027-01-01.csv'), '2027-01-01')
  assert.equal(extrairFaturaDoArquivo('Nubank_2026-12-10.csv'), '2026-12-01')
  assert.equal(extrairFaturaDoArquivo('2027-01'), '2027-01-01')
  assert.equal(extrairFaturaDoArquivo('extrato.csv'), null)
  assert.equal(extrairFaturaDoArquivo(null), null)
})

test('coloca todas as linhas na fatura do arquivo (compras da virada incluídas)', () => {
  const linhas = [t('2026-11-23', '2026-12-01'), t('2026-11-24', '2027-01-01')]
  assert.ok(aplicarFaturaDoArquivo(linhas, '2027-01-01'))
  assert.deepEqual(linhas.map(l => l.projeto_fatura), ['2027-01-01', '2027-01-01'])
})

test('ignora a fatura do arquivo se ela não bate com as datas (ex.: data de exportação)', () => {
  const linhas = [t('2026-08-10', '2026-09-01'), t('2026-11-20', '2026-12-01')]
  assert.ok(!aplicarFaturaDoArquivo(linhas, '2027-01-01'))
  assert.deepEqual(linhas.map(l => l.projeto_fatura), ['2026-09-01', '2026-12-01'])
})
