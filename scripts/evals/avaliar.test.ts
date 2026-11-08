/**
 * O conjunto de avaliação precisa reprovar as respostas ruins que o Fin deu de
 * verdade (antes desta versão) e aprovar respostas corretas. Também confere a
 * integridade dos cenários. Roda sem modelo nem banco: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CASOS } from './casos'
import { avaliar } from './avaliar'
import type { FerramentaUsada } from '../../lib/ai/agent/conversation'

const caso = (id: string) => {
  const c = CASOS.find(x => x.id === id)
  assert.ok(c, `cenário ${id} existe`)
  return c
}
const resposta = (texto: string, trilha: Array<Pick<FerramentaUsada, 'nome' | 'args'>> = [], semLastro: string[] = []) => ({
  texto,
  trilha: trilha.map(t => ({ rotulo: t.nome, ...t })),
  meta: { modelo: 'x', rodadas: 1, uso: { entrada: 0, saida: 0, raciocinio: 0 }, duracaoMs: 0, revisoes: [], lastro: { citados: 0, semLastro } },
})

test('cenários íntegros: ids únicos, datas válidas e algum critério em cada um', () => {
  const ids = CASOS.map(c => c.id)
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos')
  assert.ok(CASOS.length >= 20)
  for (const c of CASOS) {
    assert.match(c.hoje, /^\d{4}-\d{2}-\d{2}$/, c.id)
    assert.ok(!Number.isNaN(new Date(c.hoje).getTime()), c.id)
    assert.ok(Object.keys(c.espera).length > 0, `${c.id} sem critério`)
    assert.ok(c.pergunta.trim(), c.id)
  }
})

// Respostas reais (tabela messages) que motivaram cada cenário.
test('reprova as respostas ruins reais', () => {
  const ruins: Array<[string, ReturnType<typeof resposta>]> = [
    ['real-mercadinho-outubro', resposta('No mês de outubro gastamos R$ 138,50 no Mercadinho24: R$ 55,00, R$ 48,50 e R$ 35,00.', [], ['R$ 138,50'])],
    ['real-mercadinho-divisao', resposta('R$ 236,14 em 14 transações. Conjunto gastou R$ 199,12 e Matheus R$ 37,97.', [{ nome: 'consultar_transacoes', args: { agruparPor: 'descricao' } }], ['R$ 199,12', 'R$ 37,97'])],
    ['real-categoria-jeniffer', resposta('Em novembro, a categoria foi Saúde, com R$ 150,00 ("Consulta Médica").')],
    ['real-followup-parcelamentos', resposta('Considerando os parcelamentos, continua sendo Saúde, com R$ 150,00.')],
    ['real-sim-apos-duplicidade', resposta('Já existe "Sabonete" na lista. Quer incluir "sabonete íntimo" mesmo assim?', [{ nome: 'propor_item_lista_mercado' }])],
    ['real-lista-faltando', resposta('Não encontrei nenhuma compra de "limpeza" na fatura de outubro.', [{ nome: 'listar_dimensoes' }, { nome: 'consultar_transacoes', args: { categoria: 'Limpeza' } }])],
    ['real-sem-picpay', resposta('Desconsiderando o PicPay, foram R$ 27.425,87.', [{ nome: 'comparar_periodos', args: { cartao: 'nubank' } }, { nome: 'comparar_periodos', args: { cartao: 'cartao2' } }])],
    ['formato-grafico-app', resposta('Veja:\n```grafico com JSON numa linha só:\n{"tipo":"barra"}\n```', [{ nome: 'comparar_periodos' }])],
    ['tempo-comeco-do-mes', resposta('Em novembro foram R$ 64,75 no Mercadinho24.', [{ nome: 'consultar_transacoes', args: { mesInicio: '2026-11' } }])],
    ['operacao-propor-sem-gravar', resposta('Pronto, adicionei detergente e esponja!', [{ nome: 'propor_lote' }, { nome: 'confirmar_operacao' }])],
  ]
  for (const [id, r] of ruins) {
    assert.ok(avaliar(caso(id), r).length > 0, `${id} deveria reprovar`)
  }
})

test('aprova respostas corretas', () => {
  const boas: Array<[string, ReturnType<typeof resposta>]> = [
    ['real-mercadinho-outubro', resposta('Na fatura de outubro foram **R$ 236,14** em 14 compras.', [{ nome: 'consultar_transacoes' }])],
    ['real-mercadinho-divisao', resposta('Conjunto: R$ 183,17 · Matheus: R$ 52,97.', [{ nome: 'consultar_transacoes', args: { agruparPor: 'responsavel' } }])],
    ['real-categoria-jeniffer', resposta('Foi **Cosméticos**, com **R$ 526,91**.', [{ nome: 'consultar_transacoes' }])],
    ['real-sem-picpay', resposta('Sem o PicPay…', [{ nome: 'comparar_periodos', args: { excluirCartao: 'cartao1', incluirContasFixas: true } }])],
    ['real-saudacao', resposta('Oi! Como posso ajudar?')],
    ['formato-grafico-app', resposta('Leitura.\n```grafico\n{"tipo":"barra"}\n```', [{ nome: 'comparar_periodos' }])],
    ['tempo-ontem', resposta('Ontem foram…', [{ nome: 'consultar_transacoes', args: { dataInicio: '2026-10-27', dataFim: '2026-10-27' } }])],
  ]
  for (const [id, r] of boas) {
    assert.deepEqual(avaliar(caso(id), r), [], id)
  }
})
