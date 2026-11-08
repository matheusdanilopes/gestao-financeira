/**
 * Checagem de lastro com os casos reais que motivaram a regra (conversas de
 * out–nov/2026, conferidas contra o banco). Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verificarLastro, extrairValoresCitados, leiturasNumericas } from './lastro'
import { formatBRL } from '../../format'

// Trechos do que o modelo de fato leu (formatados como as ferramentas formatam).
const SNAPSHOT = [
  'SNAPSHOT DO MOMENTO',
  `  Nubank: ${formatBRL(9354.21)} → Matheus ${formatBRL(5120.4)} · Jeniffer ${formatBRL(2231.07)} · Conjunto ${formatBRL(2002.74)}`,
  `Total do mês (todos os cartões + contas fixas): ${formatBRL(18288.44)}`,
].join('\n')

const CONSULTA_MGAMERCADINHO = [
  'CONSULTA: compras · descrição contém "Mgamercadinho24h" · mês OUT/26',
  `Total: ${formatBRL(236.14)} em 14 transação(ões) · ticket médio ${formatBRL(16.87)}`,
  `  Mgamercadinho24h: ${formatBRL(236.14)} (14x)`,
  `  - 28/09/26 Mgamercadinho24h ${formatBRL(31.25)} · Conjunto · Nubank`,
  `  - 30/09/26 Mgamercadinho24h ${formatBRL(31.19)} · Conjunto · Nubank`,
].join('\n')

test('compras inventadas sem consulta ficam sem lastro (caso Mercadinho24 de outubro)', () => {
  const resposta =
    'No mês de **outubro**, gastamos **R$ 138,50** no Mercadinho24.\n' +
    '*   R$ 55,00 em 27/10/26\n*   R$ 48,50 em 25/10/26\n*   R$ 35,00 em 20/10/26'
  const r = verificarLastro(resposta, [SNAPSHOT, 'Quanto gastamos no mercadinho24'])
  assert.equal(r.citados, 4)
  assert.deepEqual(r.semLastro, ['R$ 138,50', 'R$ 55,00', 'R$ 48,50', 'R$ 35,00'])
})

test('categoria inventada sem consulta fica sem lastro (caso Saúde R$ 150,00)', () => {
  const resposta = 'Em novembro, a categoria em que você mais gastou foi **Saúde**, com **R$ 150,00**.\n*   Outros: **R$ 49,34**'
  const r = verificarLastro(resposta, [SNAPSHOT])
  assert.deepEqual(r.semLastro, ['R$ 150,00', 'R$ 49,34'])
})

test('total consultado passa; divisão feita de cabeça não (caso Mgamercadinho24h)', () => {
  const resposta =
    'Na fatura de **outubro** foram **R$ 236,14** em 14 compras.\n' +
    '*   **Conjunto** gastou R$ 199,12\n*   **Matheus** gastou R$ 37,97\n' +
    '*   R$ 31,25 em 28/09/26 (Conjunto, Nubank)'
  const r = verificarLastro(resposta, [SNAPSHOT, CONSULTA_MGAMERCADINHO])
  assert.deepEqual(r.semLastro, ['R$ 199,12', 'R$ 37,97'])
})

test('conta feita pela calculadora tem lastro', () => {
  const calculo = 'CÁLCULO (use estes resultados exatamente):\n  sem PicPay A: 26600.70 + 845.07 = 27445.77'
  const r = verificarLastro('Sem o PicPay, o total foi **R$ 27.445,77**.', [SNAPSHOT, calculo])
  assert.deepEqual(r.semLastro, [])
  // A soma errada que o modelo fez de cabeça no histórico real:
  assert.deepEqual(verificarLastro('Total: R$ 27.425,87', [SNAPSHOT, calculo]).semLastro, ['R$ 27.425,87'])
})

test('valor que o próprio usuário informou tem lastro', () => {
  const r = verificarLastro('Simulei a compra de **R$ 3.000,00** em 10x.', [SNAPSHOT, 'E se eu comprar uma TV de R$ 3.000 em 10x?'])
  assert.deepEqual(r.semLastro, [])
})

test('percentuais, contagens e datas não são checados (análise livre)', () => {
  const r = verificarLastro('Alta de **54,8%**, 14 compras desde 24/09, a maior parte (96%) do Matheus.', [SNAPSHOT])
  assert.equal(r.citados, 0)
  assert.deepEqual(r.semLastro, [])
})

test('negativos, sem centavos e aproximações', () => {
  const ev = [`Variação: ${formatBRL(-953.43)} · total ${formatBRL(1519.52)} · média ${formatBRL(1200)}`]
  assert.deepEqual(verificarLastro('Caiu -R$ 953,43.', ev).semLastro, [])
  assert.deepEqual(verificarLastro('Cerca de R$ 1.520 no mês.', ev).semLastro, [])
  assert.deepEqual(verificarLastro('Uns R$ 1,5 mil.', ev).semLastro, [])
  assert.deepEqual(verificarLastro('Uns R$ 9 mil.', ev).semLastro, ['R$ 9 mil'])
})

test('valores de gráfico em R$ são checados; em % não', () => {
  const grafico = (unidade: string, valores: number[]) =>
    '```grafico\n' + JSON.stringify({ tipo: 'barra', titulo: 't', unidade, rotulos: ['a', 'b'], series: [{ nome: 's', valores }] }) + '\n```'
  assert.deepEqual(verificarLastro(grafico('brl', [236.14, 31.25]), [CONSULTA_MGAMERCADINHO]).semLastro, [])
  assert.deepEqual(verificarLastro(grafico('brl', [236.14, 999.99]), [CONSULTA_MGAMERCADINHO]).semLastro, ['999.99 (gráfico)'])
  assert.equal(verificarLastro(grafico('pct', [12.5, 80]), [CONSULTA_MGAMERCADINHO]).citados, 0)
})

test('leituras numéricas cobrem formato brasileiro e JSON', () => {
  assert.deepEqual(leiturasNumericas('1.234,56'), [1234.56])
  assert.deepEqual(leiturasNumericas('1234.56'), [1234.56])
  assert.deepEqual(leiturasNumericas('1.234'), [1234, 1.234])
  assert.equal(extrairValoresCitados('R$ 1.234,56').length, 1)
})
