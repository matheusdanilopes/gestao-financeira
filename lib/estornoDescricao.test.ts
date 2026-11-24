import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extrairEstabelecimentoDoEstorno, estornosParecidos, compraDoEstorno, estornoTemEstabelecimento,
} from '@/lib/estornoDescricao'

test('extrai o estabelecimento nos formatos do NuBank', () => {
  assert.equal(extrairEstabelecimentoDoEstorno('Estorno de "Ifd*Elaine Felipe da S" (iFood)'), 'Ifd*Elaine Felipe da S')
  assert.equal(extrairEstabelecimentoDoEstorno('Estorno de "Mercadolivre*Radial" (Mercado Livre)'), 'Mercadolivre*Radial')
  assert.equal(extrairEstabelecimentoDoEstorno('Estorno de compra (Loja X 2x de 12x)'), 'Loja X')
  assert.equal(extrairEstabelecimentoDoEstorno('Estorno de compra (iFood)'), 'iFood')
  assert.equal(extrairEstabelecimentoDoEstorno('Estorno de Loja Y'), 'Loja Y')
})

test('acha a compra original pelo formato do extrato', () => {
  assert.ok(compraDoEstorno('Estorno de "Ifd*Elaine Felipe da S" (iFood)', 'Ifd*Elaine Felipe da S'))
  assert.ok(compraDoEstorno('Estorno de "Mercadolivre*Radial" (Mercado Livre)', 'Mercadolivre*Radial'))
  assert.ok(!compraDoEstorno('Estorno de compra (iFood)', 'Ifd*Elaine Felipe da S'))
})

test('reconhece o mesmo estorno escrito pela API e pelo extrato', () => {
  assert.ok(estornosParecidos('Estorno de compra (iFood)', 'Estorno de "Ifd*Elaine Felipe da S" (iFood)'))
  assert.ok(estornosParecidos('Estorno de compra (Mercado Livre)', 'Estorno de "Mercadolivre*Radial" (Mercado Livre)'))
  assert.ok(!estornosParecidos('Estorno de compra (iFood)', 'Estorno de "Mercadolivre*Radial" (Mercado Livre)'))
})

test('formato com estabelecimento é o mais específico', () => {
  assert.ok(estornoTemEstabelecimento('Estorno de "Ifd*Loja" (iFood)'))
  assert.ok(!estornoTemEstabelecimento('Estorno de compra (iFood)'))
})
