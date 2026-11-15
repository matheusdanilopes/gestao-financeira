/**
 * Análise do Fin: economia das dicas calculada pelo app e conferência dos
 * valores em R$ citados pela IA.
 * Rodar: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularOportunidades } from './oportunidades'
import { aplicarOportunidades, ajustarEconomias, normalizarAnalise } from './analista'
import { indexarEvidenciasAnalise, removerSemLastro, valoresSemLastro, evidenciaDoPlano } from './conferencia'
import type { AnaliseIA, CategoriaComportamento, MetricasComportamento } from './tipos'
import {
  contextoAnaliseParaChat, separarContexto, LIMITE_CONTEXTO_CHAT, MARCA_CONTEXTO_ANALISE, SEPARADOR_CONTEXTO,
} from './contextoChat'

function categoria(nome: string, recente: number, anterior: number): CategoriaComportamento {
  return {
    categoria: nome, total: recente * 3 + anterior * 3, pct: 10, mediaMensal: (recente + anterior) / 2,
    mediaRecente: recente, mediaAnterior: anterior,
    variacaoPct: anterior > 0 ? Math.round(((recente - anterior) / anterior) * 1000) / 10 : null,
    oscilacaoPct: 10, mesesComGasto: 6,
  }
}

function metricas(extra: Partial<MetricasComportamento> = {}): MetricasComportamento {
  return {
    geradoEm: '', escopo: 'casal', modo: 'meses', mesFoco: null,
    periodo: { inicio: '2026-05', fim: '2026-10', mesesFechados: 6, mesParcial: '2026-11', primeiroMesComDados: '2025-01' },
    mensal: [],
    resumo: {
      receitaMedia: 10000, gastoMedio: 9000, saldoMedio: 1000, taxaPoupancaMedia: 10, mesesNoVermelho: 1,
      tendenciaGastoPct: 8, oscilacaoGastoPct: 12, mesMaisCaro: null, mesMaisBarato: null,
    },
    fixoVariavel: {
      fixo: { contas: 3000, parcelas: 1500, assinaturas: 200, total: 4700 },
      variavel: { cartao: 3800, contas: 500, total: 4300 },
      pctFixo: 52,
    },
    saude: { nota: 60, indicadores: [] },
    quando: {
      diasSemana: [], fimDeSemanaPctValor: 30, fimDeSemanaPctQuantidade: 30, fasesDoMes: [],
      comprasPorDiaAtivo: 2, diasComCompra: 100, diasIntensos: [], semanaDoRecebimento: null,
    },
    ticket: {
      faixas: [], ticketMedio: 80, ticketMediano: 40,
      microgastos: { limite: 50, quantidade: 120, total: 3600, mediaMensal: 600, pctDoValor: 15 },
    },
    estabelecimentos: [
      { nome: 'iFood', categoria: 'Delivery', quantidade: 70, total: 4200, ticketMedio: 60, mesesPresente: 6 },
      { nome: 'Padaria Sol', categoria: 'Alimentação', quantidade: 56, total: 1400, ticketMedio: 25, mesesPresente: 6 },
    ],
    categorias: [categoria('Delivery', 900, 600), categoria('Mercado', 1500, 1480), categoria('Alimentação', 400, 380)],
    responsaveis: [],
    parcelamentos: { comprasParceladas: 5, pctComprasParceladas: 5, valorFinanciado: 3000, mediaParcelas: 6, compromissoFuturo: [], pctReceitaProximoMes: 15 },
    planejamento: {
      previstoMedio: 3000, realizadoMedio: 3100, aderenciaPct: 103,
      itensQueEstouram: [{ item: 'Luz', categoria: 'Moradia', mesesEstourados: 4, mesesAvaliados: 6, excessoMedio: 85.5 }],
      contasPagas: 30, contasComDatas: 30, pagasComAtraso: 0, atrasoMedioDias: 0, vencidasEmAberto: 0,
    },
    assinaturas: {
      ativas: 3, custoMensal: 120, pctDaReceita: 1.2,
      maiores: [
        { nome: 'Streaming A', valor: 55.9, categoria: 'Assinaturas' },
        { nome: 'Música', valor: 34.9, categoria: 'Assinaturas' },
        { nome: 'Nuvem', valor: 29.2, categoria: 'Assinaturas' },
      ],
    },
    investimentos: { totalAportado: 0, mediaMensal: 0, mesesComAporte: 0, pctDaReceita: null, saldoInformado: null },
    comprasAtipicas: [],
    estornos: { quantidade: 0, total: 0 },
    desejos: { pendentes: 0, valorPendente: 0, realizadosNoPeriodo: 0, valorRealizado: 0 },
    qualidade: { comprasSemCategoriaPct: 0, comprasAnalisadas: 400, avisos: [] },
    ...extra,
  }
}

function analise(extra: Partial<AnaliseIA> = {}): AnaliseIA {
  return normalizarAnalise({
    manchete: 'Olhei seus gastos: o delivery subiu R$ 300 por mês.',
    resumo: 'Delivery foi de R$ 600 para R$ 900. Compras pequenas somam R$ 600 por mês.',
    perfil: { nome: 'Quem pede comida', descricao: 'Você pede muito delivery.', tracos: ['delivery'] },
    padroes: [
      { titulo: 'Delivery em alta', destaque: '+50%', descricao: 'Média recente de R$ 900 contra R$ 600 antes.', impacto: 'negativo', relevancia: 'alta' },
      { titulo: 'Formiguinha', destaque: '120 compras', descricao: 'Compras de até R$ 50 somam R$ 600 por mês.', impacto: 'negativo', relevancia: 'media' },
    ],
    gatilhos: [], pontosFortes: [], riscos: [],
    planoDeAcao: [
      { acao: 'Voltar o delivery ao normal', porque: 'Economiza R$ 300 por mês.', oportunidade: 'categoria:Delivery', dificuldade: 'media', prazo: 'este mês' },
      { acao: 'Pensar antes das compras pequenas', porque: 'Elas somam R$ 600.', oportunidade: 'microgastos', dificuldade: 'facil', prazo: 'este mês' },
      { acao: 'Separar uma reserva', porque: 'Para imprevistos.', oportunidade: '', dificuldade: 'media', prazo: '3 meses' },
    ],
    metas: [], perguntas: [], limitacoes: [],
    ...extra,
  })
}

// ─── Oportunidades ───────────────────────────────────────────────────────────

test('oportunidades: categoria em alta volta ao normal pela diferença das médias', () => {
  const ops = calcularOportunidades(metricas())
  const delivery = ops.find(o => o.id === 'categoria:Delivery')
  assert.ok(delivery)
  assert.equal(delivery.economiaMensal, 300)
  assert.match(delivery.regra, /R\$\s?900.*R\$\s?600.*R\$\s?300/)
  // Mercado subiu pouco (R$ 20): não vira dica.
  assert.equal(ops.some(o => o.id === 'categoria:Mercado'), false)
})

test('oportunidades: microgastos, assinatura mais barata e conta que estoura', () => {
  const ops = calcularOportunidades(metricas())
  assert.equal(ops.find(o => o.id === 'microgastos')?.economiaMensal, 200)
  assert.equal(ops.find(o => o.id === 'assinaturas')?.economiaMensal, 29)
  assert.equal(ops.find(o => o.id === 'conta:Luz')?.economiaMensal, 85)
})

test('oportunidades: lugar frequente não repete categoria já coberta', () => {
  const ops = calcularOportunidades(metricas())
  // iFood é Delivery, já coberto pela categoria em alta.
  assert.equal(ops.some(o => o.id === 'lugar:iFood'), false)
  // Padaria: 56 compras em 7 meses = 8/mês; R$ 200/mês; um quarto = R$ 50.
  assert.equal(ops.find(o => o.id === 'lugar:Padaria Sol')?.economiaMensal, 50)
})

// ─── Dicas ligadas às oportunidades ──────────────────────────────────────────

test('a economia da dica vem do app; id desconhecido ou repetido não promete economia', () => {
  const m = metricas()
  const ops = calcularOportunidades(m)
  const a = analise()
  a.planoDeAcao.push({ ...a.planoDeAcao[0], acao: 'Repetida' })
  a.planoDeAcao.push({ ...a.planoDeAcao[2], acao: 'Inventada', oportunidade: 'categoria:Viagem' })
  const r = aplicarOportunidades(a, ops)
  assert.deepEqual(r.planoDeAcao.map(p => p.economiaMensal), [300, 200, 0, 0, 0])
  assert.equal(r.planoDeAcao[0].categoria, 'Delivery')
  assert.ok(r.planoDeAcao[0].regra)
})

test('o total das dicas não passa de metade do gasto do dia a dia', () => {
  const m = metricas({ fixoVariavel: { ...metricas().fixoVariavel!, variavel: { cartao: 600, contas: 0, total: 600 }, fixo: { contas: 0, parcelas: 0, assinaturas: 0, total: 0 } } })
  const r = ajustarEconomias(aplicarOportunidades(analise(), calcularOportunidades(m)), m)
  assert.ok(r.planoDeAcao.reduce((s, p) => s + p.economiaMensal, 0) <= 300)
  assert.equal(r.economiaAjustada, true)
})

// ─── Conferência dos valores ─────────────────────────────────────────────────

test('valores que existem nos dados (ou são diferença deles) passam na conferência', () => {
  const m = metricas()
  const ops = calcularOportunidades(m)
  const a = aplicarOportunidades(analise(), ops)
  const r = valoresSemLastro(a, indexarEvidenciasAnalise(m, ops, [evidenciaDoPlano(a)]))
  assert.deepEqual(r.semLastro, [])
  assert.ok(r.citados >= 6)
})

test('valor inventado: o item sai e a frase do resumo também', () => {
  const m = metricas()
  const ops = calcularOportunidades(m)
  const a = aplicarOportunidades(analise({
    resumo: 'Delivery foi de R$ 600 para R$ 900. Você gastou R$ 4.321,99 em viagens.',
    padroes: [
      { titulo: 'Delivery em alta', destaque: '+50%', descricao: 'Média recente de R$ 900 contra R$ 600 antes.', impacto: 'negativo', relevancia: 'alta' },
      { titulo: 'Viagem cara', destaque: 'R$ 7.777', descricao: 'Uma viagem custou R$ 7.777.', impacto: 'negativo', relevancia: 'alta' },
    ],
  }), ops)
  const idx = indexarEvidenciasAnalise(m, ops, [evidenciaDoPlano(a)])
  const sem = valoresSemLastro(a, idx).semLastro
  assert.ok(sem.includes('R$ 4.321,99'))
  assert.ok(sem.some(v => v.startsWith('R$ 7.777')))
  const limpa = removerSemLastro(a, idx)
  assert.equal(limpa.padroes.length, 1)
  assert.equal(limpa.resumo, 'Delivery foi de R$ 600 para R$ 900.')
  assert.deepEqual(valoresSemLastro(limpa, idx).semLastro, [])
})

test('economia anual da dica (× 12) tem lastro', () => {
  const m = metricas()
  const ops = calcularOportunidades(m)
  const a = aplicarOportunidades(analise({ manchete: 'Dá para guardar R$ 6.000 por ano seguindo minhas dicas.' }), ops)
  // 300 + 200 = 500 por mês → 6.000 por ano.
  assert.deepEqual(valoresSemLastro(a, indexarEvidenciasAnalise(m, ops, [evidenciaDoPlano(a)])).semLastro, [])
})

// ─── Contexto para o chat ("Conversar com o Fin") ────────────────────────────

test('contexto do chat traz recado, nota e dicas com economia, dentro do limite do servidor', () => {
  const m = metricas()
  const a = aplicarOportunidades(analise(), calcularOportunidades(m))
  const r = { parametros: { janela: 12 as const, escopo: 'casal' as const, objetivo: 'entender' as const }, metricas: m, analise: a, geradaEm: '2026-11-15T12:00:00Z' }
  const ctx = contextoAnaliseParaChat(r)
  assert.ok(ctx.startsWith(MARCA_CONTEXTO_ANALISE))
  assert.match(ctx, /Nota de saúde financeira: 60\/100/)
  assert.match(ctx, /Voltar o delivery ao normal — economia R\$\s?300,00\/mês/)
  assert.ok(ctx.length <= LIMITE_CONTEXTO_CHAT)

  // Análise enorme: as partes menos importantes saem, o começo fica.
  const grande = { ...r, analise: { ...a, padroes: Array.from({ length: 40 }, (_, i) => ({ ...a.padroes[0], titulo: `Padrão ${i}`, descricao: 'x'.repeat(150) })) } }
  const cortado = contextoAnaliseParaChat(grande)
  assert.ok(cortado.length <= LIMITE_CONTEXTO_CHAT)
  assert.match(cortado, /Dicas dadas/)
})

test('o balão mostra só a pergunta; o contexto vira etiqueta', () => {
  const gravado = `Me ajuda com as dicas?${SEPARADOR_CONTEXTO}${MARCA_CONTEXTO_ANALISE} (feita por você...)`
  assert.deepEqual(separarContexto(gravado), { texto: 'Me ajuda com as dicas?', anexo: 'Análise do Fin' })
  assert.deepEqual(separarContexto('Quanto gastei?'), { texto: 'Quanto gastei?' })
})
