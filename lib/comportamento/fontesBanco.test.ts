/**
 * Análise do Fin com as views do banco (vw_analise_*).
 * Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EnrichedData, Planejamento, Transacao } from '@/lib/ai/types'
import { calcularMetricas, chaveContaLocal } from './metricas'
import { montarFontes } from './fontesBanco'
import { calcularOportunidades } from './oportunidades'

const HOJE = new Date(2026, 10, 15) // 15/11/2026: fechados mai–out, novembro parcial
const MESES = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

function conta(id: string, mes: string, item: string, valor: number, extra: Partial<Planejamento> = {}): Planejamento {
  return {
    id, item, responsavel: 'Matheus', valor_previsto: valor, valor_real: valor, pago: true,
    categoria: 'Moradia', mes_referencia: `${mes}-01`, parcela_atual: null, total_parcelas: null, ...extra,
  }
}

function compra(id: string, mes: string, descricao: string, valor: number, extra: Partial<Transacao> = {}): Transacao {
  return {
    id, descricao, valor, responsavel: 'Matheus', categoria: 'Alimentação',
    projeto_fatura: `${mes}-01`, data: `${mes}-10`, cartao: 'nubank', status: 'PENDENTE', ...extra,
  }
}

function dados(extra: Partial<EnrichedData> = {}): EnrichedData {
  const planejamento: Planejamento[] = []
  const transacoes: Transacao[] = []
  MESES.forEach((mes, i) => {
    planejamento.push(conta(`sal-${mes}`, mes, '[RECEITA] Salário Matheus', 10000, { categoria: 'Extra' }))
    planejamento.push(conta(`cond-${mes}`, mes, 'Condomínio', 500))
    // Parcelado no nome: cada mês um "N/8" diferente.
    planejamento.push(conta(`ir-${mes}`, mes, `Imposto de Renda ${i + 1}/8`, 90, { categoria: 'Outros' }))
    transacoes.push(compra(`tx-${mes}`, mes, 'Padaria Sol', 300))
  })
  return {
    transacoes, planejamento, assinaturas: [], investimentos: [], aportes: [],
    configuracoes: [], estornos: [], recebimentos: [], ts: 0, ...extra,
  }
}

test('chave da conta ignora parcela, prefixo e "Prestação"', () => {
  assert.equal(chaveContaLocal('Imposto de Renda 4/8'), 'imposto de renda')
  assert.equal(chaveContaLocal('Formatura MV - Parcela 3/5'), 'formatura mv')
  assert.equal(chaveContaLocal('Prestação Giardini'), 'giardini')
  assert.equal(chaveContaLocal('Giardini'), 'giardini')
  assert.equal(chaveContaLocal('[PRINCIPAL] Matheus'), 'matheus')
})

test('conta parcelada no nome é fixa (antes contava como gasto fora da rotina)', () => {
  const m = calcularMetricas(dados(), { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01')
  assert.equal(m.fixoVariavel?.fixo.contas, 590)
  assert.equal(m.fixoVariavel?.variavel.contas, 0)
})

test('receita é a prevista (como no Dashboard); o que entrou vai em receitaRecebida', () => {
  const d = dados()
  const out = d.planejamento.find(p => p.id === 'sal-2026-10')!
  out.pago = false
  out.valor_real = null
  d.recebimentos = [{ planejamento_id: 'sal-2026-10', valor: 9500, data_recebimento: '2026-10-05', observacao: null }]
  const m = calcularMetricas(d, { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01')
  const out26 = m.mensal.find(x => x.mes === '2026-10')!
  assert.equal(out26.receita, 10000)
  assert.equal(out26.receitaRecebida, 9500)
})

test('mês M paga a fatura que vence em M+1 (regra do Dashboard)', () => {
  const d = dados()
  // Fatura que vence em novembro: pertence a outubro.
  d.transacoes.push(compra('nov', '2026-11', 'Loja Nova', 700, { categoria: 'Vestuário', data: '2026-10-10' }))
  d.planejamento.push(conta('fat-out', '2026-10', '[PRINCIPAL] Matheus', 700, { pago: false, valor_real: null, categoria: 'Cartão' }))
  // Estorno sem par na mesma fatura: abate o total enquanto ela não foi paga.
  d.estornos.push({ descricao: 'Estorno de compra (Loja Nova)', valor: 100, data: '2026-10-12', cartao: 'nubank', projeto_fatura: '2026-11-01', status: 'ESTORNO', responsavel: 'Matheus', conciliacao_ref: null })
  const m = calcularMetricas(d, { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01')
  const out = m.mensal.find(x => x.mes === '2026-10')!
  // Compras da fatura que vence em novembro (700) − estorno sem par (100).
  assert.equal(out.gastoCartao, 600)
  assert.ok(m.categorias.some(c => c.categoria === 'Vestuário'))
  // Maio paga a fatura que vence em junho (a padaria de 300).
  assert.equal(m.mensal.find(x => x.mes === '2026-05')!.gastoCartao, 300)
})

test('receita extraordinária fica separada da recorrente', () => {
  const d = dados()
  d.planejamento.push(conta('ferias', '2026-07', '[RECEITA] Férias Matheus', 6000, { categoria: 'Extra' }))
  const fontes = montarFontes({
    planejamento: d.planejamento.map(p => ({
      id: p.id, tipo: p.item.startsWith('[RECEITA]') ? 'receita' : 'conta', chave: chaveContaLocal(p.item),
      receita_recorrente: p.item.startsWith('[RECEITA]') ? p.id !== 'ferias' : null,
    })),
  })
  const m = calcularMetricas(d, { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01', fontes)
  assert.equal(m.resumo.receitaMedia, 11000)
  assert.equal(m.resumo.receitaRecorrenteMedia, 10000)
  assert.deepEqual(m.resumo.receitasExtras, [{ mes: '2026-07', item: 'Férias Matheus', valor: 6000 }])
})

test('compra estornada por inteiro sai das categorias', () => {
  const d = dados()
  d.transacoes.push(compra('ml', '2026-09', 'Mercadolivre*Loja', 99.4, { categoria: 'Vestuário' }))
  const sem = calcularMetricas(d, { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01')
  assert.ok(sem.categorias.some(c => c.categoria === 'Vestuário'))

  const fontes = montarFontes({
    estornos: [{ id: 'e1', descricao: 'Estorno de compra (Mercado Livre)', valor: 99.4, data: '2026-09-20', projeto_fatura: '2026-10-01', original_id: 'ml', original_descricao: 'Mercadolivre*Loja', situacao: 'original_ativo' }],
  })
  const com = calcularMetricas(d, { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01', fontes)
  assert.ok(!com.categorias.some(c => c.categoria === 'Vestuário'))
  assert.equal(com.sinais?.estornos.comprasDevolvidas.length, 1)
})

test('sinais: assinatura com dois descritores conta uma vez; pausada e não cadastrada viram oportunidade', () => {
  const rec = (descricao: string, situacao: string, extra: Record<string, unknown> = {}) => ({
    descricao, tipo: 'cobranca', faturas: 4, valor_ultimo: 20.9, ultima_data: '2026-10-28',
    categoria: 'Lazer', categorias_usadas: 1, lista_categorias: 'Lazer', responsavel: 'Matheus',
    assinatura_id: null, assinatura_nome: null, assinatura_valor: null, situacao, ...extra,
  })
  const fontes = montarFontes({
    recorrencias: [
      rec('Netflix.Com', 'cadastrada', { assinatura_id: 'nf', assinatura_nome: 'Netflix', assinatura_valor: 20.9 }),
      rec('Netflix Entretenimento', 'cadastrada', { assinatura_id: 'nf', assinatura_nome: 'Netflix', assinatura_valor: 20.9 }),
      rec('Pilates Conce', 'inativa_cobrada', { assinatura_id: 'pl', assinatura_nome: 'Pilates', assinatura_valor: 210, valor_ultimo: 210, categoria: 'Saúde' }),
      rec('Lovable', 'nao_cadastrada', { valor_ultimo: 27.84, categoria: 'Tecnologia' }),
      rec('IOF de compra internacional', 'nao_cadastrada', { tipo: 'iof', valor_ultimo: 4 }),
    ],
  })
  const m = calcularMetricas(dados(), { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01', fontes)
  const r = m.sinais!.cobrancasRecorrentes
  assert.equal(r.cadastradasCobradas, 1)
  assert.deepEqual(r.pausadasCobradas.map(p => p.nome), ['Pilates'])
  assert.deepEqual(r.naoCadastradas.map(p => p.descricao), ['Lovable'])
  assert.equal(r.iofMensal, 4)

  const ids = calcularOportunidades(m).map(o => o.id)
  assert.ok(ids.includes('pausada:Pilates'))
  assert.ok(ids.includes('recorrente:Lovable'))
})

test('visão individual avisa quanto do Conjunto ficou de fora', () => {
  const d = dados()
  d.transacoes.push(compra('cj', '2026-08', 'Mercado Bom', 600, { responsavel: 'Conjunto' }))
  const m = calcularMetricas(d, { janela: 6, escopo: 'Matheus' }, HOJE, '2026-05-01')
  assert.ok(m.qualidade.avisos.some(a => a.includes('Conjunto') && a.includes('1 lançamentos')))
})

test('fatura paga sem compras importadas vira aviso', () => {
  const fontes = montarFontes({
    cobertura: [{ mes: '2026-05-01', cartao: 'cartao1', paga: true, valor_pago: 2215.47, valor_importado: 0, pct_sem_detalhe: 100 }],
  })
  const m = calcularMetricas(dados(), { janela: 6, escopo: 'casal' }, HOJE, '2026-05-01', fontes)
  assert.equal(m.sinais?.faturasSemDetalhe.length, 1)
  assert.ok(m.qualidade.avisos.some(a => a.includes('cartão 1 em mai/26')))
})
