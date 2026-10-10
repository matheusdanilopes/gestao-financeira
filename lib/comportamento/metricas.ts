/**
 * Motor de métricas da Análise de Comportamento.
 *
 * O analista (IA) não recebe lançamentos crus: recebe estas métricas, já
 * calculadas aqui com as convenções do app. Dois motivos:
 *  - um modelo somando milhares de compras erra contas em silêncio — aqui a
 *    matemática é determinística e a IA só interpreta;
 *  - o pacote fica pequeno o bastante para caber, junto com o raciocínio,
 *    no orçamento de tempo de uma requisição.
 *
 * Convenções (as mesmas dos relatórios):
 *  - compras do cartão contam no mês da fatura (projeto_fatura);
 *  - gasto do mês = compras do cartão + contas reais do planejamento (sem as
 *    linhas de pagamento de fatura, que duplicariam as compras);
 *  - "compra nova" = compra à vista ou 1ª parcela. É ela que mostra o momento
 *    da decisão de gastar; as parcelas seguintes só repetem a decisão. Isso
 *    importa: a importação lança as parcelas em andamento com a data de
 *    abertura da fatura, e contá-las como compras criaria um falso "pico de
 *    compras" no primeiro dia de toda fatura. A parcela é lida das colunas ou,
 *    na falta delas, do "N/M" da descrição — nem toda importação preenche as
 *    colunas.
 *  - o mês corrente entra na série como parcial e fica fora das médias.
 */

import { format, startOfMonth, subMonths } from 'date-fns'
import { ehDespesaReal, removerPrefixoCartao } from '@/lib/tipoCartao'
import { extrairParcela, type ParcelaInfo } from '@/lib/parcelaDescricao'
import type { EnrichedData, Planejamento, Transacao } from '@/lib/ai/types'
import type {
  CategoriaComportamento,
  Comparativo,
  CompraAtipica,
  EscopoAnalise,
  Estabelecimento,
  FatiaTempo,
  IndicadorSaude,
  ItemQueEstoura,
  MesComportamento,
  MetricasComportamento,
  LancamentoFatura,
  MesFoco,
  ParametrosAnalise,
} from './tipos'
import { JANELA_ULTIMO_MES, MESES_BASE_ULTIMO_MES } from './tipos'

const LIMITE_MICROGASTO = 50
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const FASES_MES: Array<{ rotulo: string; de: number; ate: number }> = [
  { rotulo: 'Dias 1–5', de: 1, ate: 5 },
  { rotulo: 'Dias 6–10', de: 6, ate: 10 },
  { rotulo: 'Dias 11–15', de: 11, ate: 15 },
  { rotulo: 'Dias 16–20', de: 16, ate: 20 },
  { rotulo: 'Dias 21–25', de: 21, ate: 25 },
  { rotulo: 'Dias 26–31', de: 26, ate: 31 },
]
const FAIXAS_TICKET: Array<{ faixa: string; ate: number }> = [
  { faixa: 'Até R$ 30', ate: 30 },
  { faixa: 'R$ 30 a 100', ate: 100 },
  { faixa: 'R$ 100 a 300', ate: 300 },
  { faixa: 'R$ 300 a 1.000', ate: 1000 },
  { faixa: 'Acima de R$ 1.000', ate: Infinity },
]

// ─── Utilitários ─────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
const r1 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 10) / 10
const soma = (xs: number[]) => xs.reduce((a, x) => a + x, 0)
const media = (xs: number[]) => (xs.length ? soma(xs) / xs.length : 0)
const pct = (parte: number, todo: number) => (todo > 0 ? r1((parte / todo) * 100) : 0)
const limitar = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n))

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0
  const o = [...xs].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/** Coeficiente de variação em % (desvio-padrão / média). */
function oscilacao(xs: number[]): number {
  const m = media(xs)
  if (xs.length < 2 || m <= 0) return 0
  const variancia = media(xs.map(x => (x - m) ** 2))
  return r1((Math.sqrt(variancia) / m) * 100)
}

/**
 * Variação % — null quando a base é zero ou ínfima perto do valor atual
 * (menos de 5%): "+781.983%" não diz nada, "não existia antes" diz.
 */
function variacao(atual: number, anterior: number): number | null {
  if (anterior <= 0 || anterior < Math.abs(atual) * 0.05) return null
  return r1(((atual - anterior) / anterior) * 100)
}

/** 'YYYY-MM' + n meses. */
function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const total = a * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' → Date local, ou null se inválida. */
function lerData(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

const normalizarPessoa = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

function filtroEscopo(escopo: EscopoAnalise): (resp: string | null | undefined) => boolean {
  if (escopo === 'casal') return () => true
  const alvo = normalizarPessoa(escopo)
  return resp => normalizarPessoa(resp) === alvo
}

/** Nome do estabelecimento sem número de parcela, códigos e sufixos de cidade. */
function chaveEstabelecimento(t: Transacao): { chave: string; rotulo: string } {
  const bruto = (t.descricao_personalizada || t.descricao || '').trim()
  const limpo = bruto
    .replace(/\s*-?\s*parcela\s*\d+\s*\/\s*\d+/gi, '')
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const chave = limpo
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22)
  return { chave: chave || bruto.toLowerCase(), rotulo: limpo.slice(0, 40) || bruto }
}

const ehReceita = (p: Planejamento) => String(p.item ?? '').trim().startsWith('[RECEITA]')

/** Valor da conta no mês: o pago quando pago; o previsto enquanto em aberto. */
const valorConta = (p: Planejamento) =>
  p.pago ? Number(p.valor_real ?? p.valor_previsto ?? 0) : Number(p.valor_previsto ?? 0)

const cacheParcela = new WeakMap<Transacao, ParcelaInfo | null>()
function parcelaDe(t: Transacao): ParcelaInfo | null {
  if (!cacheParcela.has(t)) cacheParcela.set(t, extrairParcela(t.descricao, t.parcela_atual, t.total_parcelas))
  return cacheParcela.get(t) ?? null
}
/** À vista ou 1ª parcela. Parcela 2+ é compra antiga, com a data de abertura da fatura. */
const ehCompraNova = (t: Transacao) => (parcelaDe(t)?.atual ?? 1) <= 1
const ehParcelada = (t: Transacao) => (parcelaDe(t)?.total ?? 1) > 1
/** Valor da decisão de compra: numa compra parcelada, o valor cheio. */
const valorDaCompra = (t: Transacao) => (ehParcelada(t) ? t.valor * (parcelaDe(t)?.total ?? 1) : t.valor)

// ─── Cálculo ─────────────────────────────────────────────────────────────────

export function calcularMetricas(
  dados: EnrichedData,
  parametros: Pick<ParametrosAnalise, 'janela' | 'escopo'>,
  hoje: Date,
  primeiroMesComDados: string | null,
): MetricasComportamento {
  const { janela, escopo } = parametros
  const doEscopo = filtroEscopo(escopo)
  const avisos = [...(dados.avisos ?? [])]

  // No modo "último mês", a série mensal traz o mês em foco e os 6 anteriores
  // (o "normal" de referência); o comportamento (quando, quanto, onde) é
  // medido só nas faturas pagas no mês em foco.
  const modoMes = janela === JANELA_ULTIMO_MES
  const mesesSerie = modoMes ? MESES_BASE_ULTIMO_MES + 1 : janela
  const hojeIso = format(hoje, 'yyyy-MM-dd')

  const mesParcial = format(hoje, 'yyyy-MM')
  const janelaPedida = Array.from({ length: mesesSerie }, (_, i) =>
    format(startOfMonth(subMonths(hoje, mesesSerie - i)), 'yyyy-MM'))
  // Início do uso = primeiro mês com receita registrada (do casal, qualquer
  // escopo). Antes disso o app só tem compras soltas da primeira fatura
  // importada: um mês "sem receita e com gasto" derrubaria médias e notas.
  const inicioUso = dados.planejamento
    .filter(p => ehReceita(p) && Number(p.valor_previsto ?? 0) > 0)
    .map(p => (p.mes_referencia ?? '').substring(0, 7))
    .sort()[0] ?? null
  const cortados = inicioUso ? janelaPedida.filter(m => m < inicioUso) : []
  const fechados = cortados.length === janelaPedida.length
    ? janelaPedida.slice(-1)
    : janelaPedida.filter(m => !cortados.includes(m))
  if (cortados.length > 0 && inicioUso) {
    const [ano, mes] = inicioUso.split('-')
    const nomeMes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mes) - 1]
    avisos.push(`O uso do app começou em ${nomeMes}/${ano} (primeiro mês com receita): ${cortados.length === 1 ? 'o mês anterior ficou' : `os ${cortados.length} meses anteriores ficaram`} de fora da análise.`)
  }
  const todos = [...fechados, mesParcial]
  const setFechados = new Set(fechados)
  const setTodos = new Set(todos)

  // ── Fontes filtradas pelo escopo e pela janela ──
  const transacoesEscopo = dados.transacoes.filter(t => Number(t.valor) > 0 && doEscopo(t.responsavel))
  const transacoes = transacoesEscopo.filter(t => setTodos.has((t.projeto_fatura ?? '').substring(0, 7)))
  const planejamento = dados.planejamento.filter(p =>
    setTodos.has((p.mes_referencia ?? '').substring(0, 7)) && doEscopo(p.responsavel))
  const contas = planejamento.filter(p => ehDespesaReal(p.item))
  const receitas = planejamento.filter(ehReceita)

  const recebimentosPorId = new Map<string, { total: number; datas: string[] }>()
  for (const r of dados.recebimentos ?? []) {
    const atual = recebimentosPorId.get(r.planejamento_id) ?? { total: 0, datas: [] }
    atual.total += Number(r.valor ?? 0)
    if (r.data_recebimento) atual.datas.push(r.data_recebimento)
    recebimentosPorId.set(r.planejamento_id, atual)
  }
  const valorRecebido = (p: Planejamento) =>
    p.pago ? Number(p.valor_real ?? p.valor_previsto ?? 0) : (p.id ? recebimentosPorId.get(p.id)?.total ?? 0 : 0)

  // Aportes e estornos não têm responsável: só fazem sentido na visão do casal.
  const visaoCasal = escopo === 'casal'
  if (!visaoCasal) {
    avisos.push(`Aportes de investimento e estornos não têm responsável no app; na visão de ${escopo} eles ficam de fora.`)
  }
  const aportes = visaoCasal
    ? (dados.aportes ?? []).filter(a => setTodos.has((a.data_aporte ?? '').substring(0, 7)))
    : []

  // ── Série mensal ──
  const mensal: MesComportamento[] = todos.map(mes => {
    const doMes = transacoes.filter(t => t.projeto_fatura.startsWith(mes))
    const gastoCartao = soma(doMes.map(t => t.valor))
    const contasMes = soma(contas.filter(p => p.mes_referencia.startsWith(mes)).map(valorConta))
    const receita = soma(receitas.filter(p => p.mes_referencia.startsWith(mes)).map(valorRecebido))
    const gastoTotal = gastoCartao + contasMes
    const novas = doMes.filter(ehCompraNova)
    return {
      mes,
      parcial: mes === mesParcial,
      receita: r2(receita),
      gastoCartao: r2(gastoCartao),
      contas: r2(contasMes),
      gastoTotal: r2(gastoTotal),
      saldo: r2(receita - gastoTotal),
      taxaPoupanca: receita > 0 ? r1(((receita - gastoTotal) / receita) * 100) : null,
      aportes: r2(soma(aportes.filter(a => a.data_aporte.startsWith(mes)).map(a => Number(a.valor ?? 0)))),
      comprasNovas: novas.length,
      novosParcelamentos: novas.filter(ehParcelada).length,
    }
  })
  const mesesFechados = mensal.filter(m => !m.parcial)
  const comReceita = mesesFechados.filter(m => m.receita > 0)

  const receitaMedia = media(comReceita.map(m => m.receita))
  const gastos = mesesFechados.map(m => m.gastoTotal)
  const gastoMedio = media(gastos)
  const recentes3 = mesesFechados.slice(-3).map(m => m.gastoTotal)
  const anteriores3 = mesesFechados.slice(-6, -3).map(m => m.gastoTotal)
  const ordenadosPorGasto = [...mesesFechados].filter(m => m.gastoTotal > 0).sort((a, b) => b.gastoTotal - a.gastoTotal)
  const taxaPoupancaMedia = receitaMedia > 0
    ? r1(((soma(comReceita.map(m => m.receita)) - soma(comReceita.map(m => m.gastoTotal))) / soma(comReceita.map(m => m.receita))) * 100)
    : null

  const resumo: MetricasComportamento['resumo'] = {
    receitaMedia: r2(receitaMedia),
    gastoMedio: r2(gastoMedio),
    saldoMedio: r2(media(comReceita.map(m => m.saldo))),
    taxaPoupancaMedia,
    mesesNoVermelho: comReceita.filter(m => m.saldo < 0).length,
    tendenciaGastoPct: anteriores3.length > 0 ? variacao(media(recentes3), media(anteriores3)) : null,
    oscilacaoGastoPct: oscilacao(gastos),
    mesMaisCaro: ordenadosPorGasto[0] ? { mes: ordenadosPorGasto[0].mes, valor: ordenadosPorGasto[0].gastoTotal } : null,
    mesMaisBarato: ordenadosPorGasto.length
      ? { mes: ordenadosPorGasto[ordenadosPorGasto.length - 1].mes, valor: ordenadosPorGasto[ordenadosPorGasto.length - 1].gastoTotal }
      : null,
  }

  // ── Quando gasta (compras novas, pela data da compra) ──
  const novasBase = transacoes.filter(ehCompraNova)
  const mesFoco = fechados[fechados.length - 1]
  const novas = modoMes ? novasBase.filter(t => t.projeto_fatura.startsWith(mesFoco)) : novasBase
  const novasComData = novas
    .map(t => ({ t, d: lerData(t.data), valor: valorDaCompra(t) }))
    .filter((x): x is { t: Transacao; d: Date; valor: number } => x.d !== null)
  const totalNovas = soma(novasComData.map(x => x.valor))

  const fatia = (rotulo: string, itens: typeof novasComData): FatiaTempo => {
    const total = soma(itens.map(x => x.valor))
    return {
      rotulo,
      total: r2(total),
      quantidade: itens.length,
      pctValor: pct(total, totalNovas),
      pctQuantidade: pct(itens.length, novasComData.length),
      ticketMedio: r2(itens.length ? total / itens.length : 0),
    }
  }
  // Semana começando na segunda: é como as pessoas pensam a semana.
  const diasSemana = [1, 2, 3, 4, 5, 6, 0].map(dia =>
    fatia(DIAS_SEMANA[dia], novasComData.filter(x => x.d.getDay() === dia)))
  const fimDeSemana = novasComData.filter(x => x.d.getDay() === 0 || x.d.getDay() === 6)
  const fasesDoMes = FASES_MES.map(f =>
    fatia(f.rotulo, novasComData.filter(x => x.d.getDate() >= f.de && x.d.getDate() <= f.ate)))
  // Dia da semana × fase do mês: onde o hábito se concentra de verdade.
  const ordemDias = [1, 2, 3, 4, 5, 6, 0]
  const mapaQtd = ordemDias.map(() => FASES_MES.map(() => 0))
  const mapaValor = ordemDias.map(() => FASES_MES.map(() => 0))
  for (const x of novasComData) {
    const i = ordemDias.indexOf(x.d.getDay())
    const j = FASES_MES.findIndex(f => x.d.getDate() >= f.de && x.d.getDate() <= f.ate)
    if (i < 0 || j < 0) continue
    mapaQtd[i][j] += 1
    mapaValor[i][j] += x.valor
  }

  const porDia = new Map<string, { quantidade: number; total: number }>()
  for (const x of novasComData) {
    const chave = format(x.d, 'yyyy-MM-dd')
    const atual = porDia.get(chave) ?? { quantidade: 0, total: 0 }
    atual.quantidade += 1
    atual.total += x.valor
    porDia.set(chave, atual)
  }
  const diasIntensos = [...porDia.entries()]
    .filter(([, v]) => v.quantidade >= 5)
    .sort((a, b) => b[1].quantidade - a[1].quantidade || b[1].total - a[1].total)
    .slice(0, 6)
    .map(([data, v]) => ({ data, quantidade: v.quantidade, total: r2(v.total) }))

  // Semana do recebimento: datas em que entrou receita na janela.
  const datasRecebimento: Date[] = []
  for (const p of receitas) {
    if (p.pago && p.data_pagamento) {
      const d = lerData(p.data_pagamento)
      if (d) datasRecebimento.push(d)
    }
    for (const iso of (p.id ? recebimentosPorId.get(p.id)?.datas : undefined) ?? []) {
      const d = lerData(iso)
      if (d) datasRecebimento.push(d)
    }
  }
  datasRecebimento.sort((a, b) => a.getTime() - b.getTime())
  let semanaDoRecebimento: MetricasComportamento['quando']['semanaDoRecebimento'] = null
  if (datasRecebimento.length >= 2 && totalNovas > 0) {
    const DIA_MS = 86_400_000
    let naSemana = 0
    for (const x of novasComData) {
      // Último recebimento até a data da compra.
      let ultimo: Date | null = null
      for (const d of datasRecebimento) {
        if (d.getTime() <= x.d.getTime()) ultimo = d
        else break
      }
      if (ultimo && (x.d.getTime() - ultimo.getTime()) / DIA_MS <= 6) naSemana += x.valor
    }
    const contagemDias = new Map<number, number>()
    for (const d of datasRecebimento) contagemDias.set(d.getDate(), (contagemDias.get(d.getDate()) ?? 0) + 1)
    semanaDoRecebimento = {
      pctValor: pct(naSemana, totalNovas),
      esperadoPct: 23,
      diasDeRecebimento: [...contagemDias.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([dia]) => dia).sort((a, b) => a - b),
    }
  }

  // ── Tamanho das compras ──
  const valoresNovas = novas.map(valorDaCompra)
  const totalValorNovas = soma(valoresNovas)
  let piso = 0
  const faixas = FAIXAS_TICKET.map(f => {
    const de = piso
    piso = f.ate
    const itens = valoresNovas.filter(v => v > de && v <= f.ate)
    return {
      faixa: f.faixa,
      quantidade: itens.length,
      total: r2(soma(itens)),
      pctQuantidade: pct(itens.length, valoresNovas.length),
      pctValor: pct(soma(itens), totalValorNovas),
    }
  })
  const micro = valoresNovas.filter(v => v <= LIMITE_MICROGASTO)
  const mesesComCompra = modoMes ? 1 : Math.max(1, new Set(novas.map(t => t.projeto_fatura.substring(0, 7))).size)

  // ── Onde gasta: frequência por estabelecimento ──
  const estabMap = new Map<string, { rotulos: Map<string, number>; categoria: Map<string, number>; quantidade: number; total: number; meses: Set<string> }>()
  for (const t of novas) {
    const { chave, rotulo } = chaveEstabelecimento(t)
    const atual = estabMap.get(chave) ?? { rotulos: new Map(), categoria: new Map(), quantidade: 0, total: 0, meses: new Set<string>() }
    atual.rotulos.set(rotulo, (atual.rotulos.get(rotulo) ?? 0) + 1)
    const cat = t.categoria || 'Sem categoria'
    atual.categoria.set(cat, (atual.categoria.get(cat) ?? 0) + 1)
    atual.quantidade += 1
    atual.total += valorDaCompra(t)
    atual.meses.add(t.projeto_fatura.substring(0, 7))
    estabMap.set(chave, atual)
  }
  const maisFrequente = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const estabelecimentos: Estabelecimento[] = [...estabMap.values()]
    .filter(e => e.quantidade >= 2)
    .sort((a, b) => b.quantidade - a.quantidade || b.total - a.total)
    .slice(0, 15)
    .map(e => ({
      nome: maisFrequente(e.rotulos),
      categoria: maisFrequente(e.categoria),
      quantidade: e.quantidade,
      total: r2(e.total),
      ticketMedio: r2(e.total / e.quantidade),
      mesesPresente: e.meses.size,
    }))

  // ── Categorias (cartão + contas reais, meses fechados) ──
  const catMes = new Map<string, Map<string, number>>()
  const somarCat = (cat: string | null, mes: string, valor: number) => {
    if (!setFechados.has(mes)) return
    const c = cat || 'Sem categoria'
    const m = catMes.get(c) ?? new Map<string, number>()
    m.set(mes, (m.get(mes) ?? 0) + valor)
    catMes.set(c, m)
  }
  for (const t of transacoes) somarCat(t.categoria, t.projeto_fatura.substring(0, 7), t.valor)
  for (const p of contas) somarCat(p.categoria, p.mes_referencia.substring(0, 7), valorConta(p))
  const totalCategorias = soma([...catMes.values()].flatMap(m => [...m.values()]))
  const recentesMeses = fechados.slice(-3)
  const anterioresMeses = fechados.slice(0, -3)
  const categorias: CategoriaComportamento[] = [...catMes.entries()]
    .map(([categoria, m]) => {
      const serie = fechados.map(mes => m.get(mes) ?? 0)
      const total = soma(serie)
      const mediaRecente = media(recentesMeses.map(mes => m.get(mes) ?? 0))
      const mediaAnterior = media(anterioresMeses.map(mes => m.get(mes) ?? 0))
      return {
        categoria,
        total: r2(total),
        pct: pct(total, totalCategorias),
        mediaMensal: r2(total / fechados.length),
        mediaRecente: r2(mediaRecente),
        mediaAnterior: r2(mediaAnterior),
        variacaoPct: anterioresMeses.length ? variacao(mediaRecente, mediaAnterior) : null,
        oscilacaoPct: oscilacao(serie),
        mesesComGasto: serie.filter(v => v > 0).length,
      }
    })
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 15)

  // ── Quem gasta (cartão) ──
  const respMap = new Map<string, { total: number; quantidade: number; valorNovas: number }>()
  for (const t of transacoes.filter(t => setFechados.has(t.projeto_fatura.substring(0, 7)))) {
    const nome = t.responsavel || 'Sem responsável'
    const atual = respMap.get(nome) ?? { total: 0, quantidade: 0, valorNovas: 0 }
    atual.total += t.valor
    if (ehCompraNova(t)) {
      atual.quantidade += 1
      atual.valorNovas += valorDaCompra(t)
    }
    respMap.set(nome, atual)
  }
  const totalResp = soma([...respMap.values()].map(v => v.total))
  const responsaveis = [...respMap.entries()]
    .map(([nome, v]) => ({
      nome,
      total: r2(v.total),
      pct: pct(v.total, totalResp),
      quantidade: v.quantidade,
      ticketMedio: r2(v.quantidade ? v.valorNovas / v.quantidade : 0),
    }))
    .sort((a, b) => b.total - a.total)

  // ── Parcelamentos ──
  const parceladas = novas.filter(ehParcelada)
  const ultimaFaturaPorCartao = new Map<string, string>()
  const tetoFatura = somarMes(mesParcial, 1)
  for (const t of transacoesEscopo) {
    const mes = (t.projeto_fatura ?? '').substring(0, 7)
    const cartao = t.cartao ?? 'nubank'
    if (mes > tetoFatura) continue
    if (mes > (ultimaFaturaPorCartao.get(cartao) ?? '')) ultimaFaturaPorCartao.set(cartao, mes)
  }
  const compromisso = new Map<string, number>()
  for (const t of transacoesEscopo) {
    const cartao = t.cartao ?? 'nubank'
    const base = ultimaFaturaPorCartao.get(cartao)
    if (!base || !t.projeto_fatura.startsWith(base) || !ehParcelada(t)) continue
    const parcela = parcelaDe(t)
    const restantes = (parcela?.total ?? 1) - (parcela?.atual ?? 1)
    for (let k = 1; k <= restantes; k++) {
      const mes = somarMes(base, k)
      if (mes > somarMes(mesParcial, 7)) break
      compromisso.set(mes, (compromisso.get(mes) ?? 0) + t.valor)
    }
  }
  const compromissoFuturo = [...compromisso.entries()]
    .filter(([mes]) => mes > mesParcial)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([mes, valor]) => ({ mes, valor: r2(valor) }))

  // ── Planejamento: aderência e pontualidade ──
  const contasFechadas = contas.filter(p => setFechados.has(p.mes_referencia.substring(0, 7)))
  const pagas = contasFechadas.filter(p => p.pago)
  const previstoPagas = soma(pagas.map(p => Number(p.valor_previsto ?? 0)))
  const realizadoPagas = soma(pagas.map(p => Number(p.valor_real ?? p.valor_previsto ?? 0)))
  const atrasos: number[] = []
  let comDatas = 0
  for (const p of pagas) {
    const venc = lerData(p.data_vencimento)
    const pag = lerData(p.data_pagamento)
    if (!venc || !pag) continue
    comDatas += 1
    const dias = Math.round((pag.getTime() - venc.getTime()) / 86_400_000)
    if (dias > 0) atrasos.push(dias)
  }
  const porItem = new Map<string, { rotulo: string; categoria: string; avaliados: number; estouros: number[] }>()
  for (const p of pagas) {
    const previsto = Number(p.valor_previsto ?? 0)
    if (previsto <= 0) continue
    const rotulo = removerPrefixoCartao(p.item)
    const chave = rotulo.toLowerCase()
    const atual = porItem.get(chave) ?? { rotulo, categoria: p.categoria || 'Sem categoria', avaliados: 0, estouros: [] }
    atual.avaliados += 1
    const real = Number(p.valor_real ?? previsto)
    if (real > previsto * 1.05 && real - previsto >= 5) atual.estouros.push(real - previsto)
    porItem.set(chave, atual)
  }
  const itensQueEstouram: ItemQueEstoura[] = [...porItem.values()]
    .filter(i => i.estouros.length >= 2 && i.estouros.length / i.avaliados >= 0.5)
    .sort((a, b) => soma(b.estouros) - soma(a.estouros))
    .slice(0, 6)
    .map(i => ({
      item: i.rotulo,
      categoria: i.categoria,
      mesesEstourados: i.estouros.length,
      mesesAvaliados: i.avaliados,
      excessoMedio: r2(media(i.estouros)),
    }))
  const vencidasEmAberto = contas.filter(p => !p.pago && p.data_vencimento && p.data_vencimento < hojeIso).length

  // ── Assinaturas ──
  const assinaturasAtivas = (dados.assinaturas ?? []).filter(a =>
    a.ativa && doEscopo(a.responsavel) && !(a.pausada_ate && a.pausada_ate > hojeIso))
  const custoAssinaturas = soma(assinaturasAtivas.map(a => Number(a.valor ?? 0)))

  // ── Investimentos (só na visão do casal) ──
  const totalAportado = soma(aportes.filter(a => setFechados.has(a.data_aporte.substring(0, 7))).map(a => Number(a.valor ?? 0)))
  const ultimoSaldo = new Map<string, { data: string; saldo: number }>()
  for (const a of visaoCasal ? dados.aportes ?? [] : []) {
    if (a.saldo_atual === null || a.saldo_atual === undefined) continue
    const atual = ultimoSaldo.get(a.investimento_id)
    if (!atual || a.data_aporte > atual.data) ultimoSaldo.set(a.investimento_id, { data: a.data_aporte, saldo: Number(a.saldo_atual) })
  }

  // ── Compras fora do padrão ──
  // A mediana de cada categoria vem da janela inteira: no modo "último mês",
  // uma compra é "fora do padrão" em relação ao normal, não ao próprio mês.
  const valoresPorCategoria = new Map<string, number[]>()
  for (const t of novasBase) {
    const c = t.categoria || 'Sem categoria'
    const lista = valoresPorCategoria.get(c) ?? []
    lista.push(valorDaCompra(t))
    valoresPorCategoria.set(c, lista)
  }
  const medianas = new Map([...valoresPorCategoria.entries()].filter(([, v]) => v.length >= 4).map(([c, v]) => [c, mediana(v)]))
  const comprasAtipicas: CompraAtipica[] = novas
    .map(t => {
      const valor = valorDaCompra(t)
      const med = medianas.get(t.categoria || 'Sem categoria')
      return { t, valor, vezes: med && med > 0 ? valor / med : 0 }
    })
    .filter(x => x.vezes >= 4 && x.valor >= 150)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
    .map(x => ({
      data: x.t.data,
      descricao: (x.t.descricao_personalizada || x.t.descricao).slice(0, 50),
      categoria: x.t.categoria || 'Sem categoria',
      responsavel: x.t.responsavel,
      valor: r2(x.valor),
      vezesMediana: r1(x.vezes),
      parcelada: ehParcelada(x.t),
    }))

  // ── Estornos e desejos ──
  const estornos = visaoCasal
    ? (dados.estornos ?? []).filter(e => setTodos.has((e.projeto_fatura ?? '').substring(0, 7)))
    : []
  const desejos = dados.desejos ?? []
  const realizadosNoPeriodo = desejos.filter(d => d.realizado && d.realizado_em && setTodos.has(d.realizado_em.substring(0, 7)))

  const metricas: MetricasComportamento = {
    geradoEm: new Date().toISOString(),
    escopo,
    modo: modoMes ? 'ultimo_mes' : 'meses',
    mesFoco: modoMes ? calcularMesFoco(fechados, transacoes, mensal) : null,
    periodo: {
      inicio: fechados[0],
      fim: fechados[fechados.length - 1],
      mesesFechados: fechados.length,
      mesParcial,
      primeiroMesComDados: inicioUso ?? (primeiroMesComDados ? primeiroMesComDados.substring(0, 7) : null),
    },
    mensal,
    resumo,
    saude: { nota: 0, indicadores: [] },
    quando: {
      diasSemana,
      fimDeSemanaPctValor: pct(soma(fimDeSemana.map(x => x.valor)), totalNovas),
      fimDeSemanaPctQuantidade: pct(fimDeSemana.length, novasComData.length),
      fasesDoMes,
      comprasPorDiaAtivo: r1(porDia.size ? novasComData.length / porDia.size : 0),
      diasComCompra: porDia.size,
      diasIntensos,
      semanaDoRecebimento,
      mapaCalor: {
        dias: ordemDias.map(d => DIAS_SEMANA[d].slice(0, 3)),
        fases: FASES_MES.map(f => f.rotulo.replace('Dias ', '')),
        quantidade: mapaQtd,
        valor: mapaValor.map(l => l.map(r2)),
      },
    },
    ticket: {
      faixas,
      ticketMedio: r2(valoresNovas.length ? totalValorNovas / valoresNovas.length : 0),
      ticketMediano: r2(mediana(valoresNovas)),
      microgastos: {
        limite: LIMITE_MICROGASTO,
        quantidade: micro.length,
        total: r2(soma(micro)),
        mediaMensal: r2(soma(micro) / mesesComCompra),
        pctDoValor: pct(soma(micro), totalValorNovas),
      },
    },
    estabelecimentos,
    categorias,
    responsaveis,
    parcelamentos: {
      comprasParceladas: parceladas.length,
      pctComprasParceladas: pct(parceladas.length, novas.length),
      valorFinanciado: r2(soma(parceladas.map(valorDaCompra))),
      mediaParcelas: r1(media(parceladas.map(t => parcelaDe(t)?.total ?? 1))),
      compromissoFuturo,
      pctReceitaProximoMes: compromissoFuturo[0] && receitaMedia > 0 ? pct(compromissoFuturo[0].valor, receitaMedia) : null,
    },
    planejamento: {
      previstoMedio: r2(soma(contasFechadas.map(p => Number(p.valor_previsto ?? 0))) / fechados.length),
      realizadoMedio: r2(soma(contasFechadas.map(valorConta)) / fechados.length),
      aderenciaPct: previstoPagas > 0 ? pct(realizadoPagas, previstoPagas) : null,
      itensQueEstouram,
      contasPagas: pagas.length,
      contasComDatas: comDatas,
      pagasComAtraso: atrasos.length,
      atrasoMedioDias: r1(media(atrasos)),
      vencidasEmAberto,
    },
    assinaturas: {
      ativas: assinaturasAtivas.length,
      custoMensal: r2(custoAssinaturas),
      pctDaReceita: receitaMedia > 0 ? pct(custoAssinaturas, receitaMedia) : null,
      maiores: [...assinaturasAtivas]
        .sort((a, b) => Number(b.valor) - Number(a.valor))
        .slice(0, 6)
        .map(a => ({ nome: a.nome, valor: r2(Number(a.valor)), categoria: a.categoria || 'Outros' })),
    },
    investimentos: {
      totalAportado: r2(totalAportado),
      mediaMensal: r2(totalAportado / fechados.length),
      mesesComAporte: mesesFechados.filter(m => m.aportes > 0).length,
      pctDaReceita: receitaMedia > 0 && visaoCasal ? pct(totalAportado / fechados.length, receitaMedia) : null,
      saldoInformado: ultimoSaldo.size ? r2(soma([...ultimoSaldo.values()].map(v => v.saldo))) : null,
    },
    comprasAtipicas,
    estornos: { quantidade: estornos.length, total: r2(soma(estornos.map(e => Math.abs(Number(e.valor ?? 0))))) },
    desejos: {
      pendentes: desejos.filter(d => !d.realizado).length,
      valorPendente: r2(soma(desejos.filter(d => !d.realizado).map(d => Number(d.valor_estimado ?? 0)))),
      realizadosNoPeriodo: realizadosNoPeriodo.length,
      valorRealizado: r2(soma(realizadosNoPeriodo.map(d => Number(d.valor_estimado ?? 0)))),
    },
    qualidade: {
      comprasSemCategoriaPct: pct(novas.filter(t => !t.categoria).length, novas.length),
      comprasAnalisadas: novas.length,
      avisos,
    },
  }

  if (comReceita.length === 0) {
    avisos.push('Nenhuma receita recebida registrada no período: taxa de poupança e saldo não podem ser avaliados.')
  }
  if (comDatas === 0 && pagas.length > 0) {
    avisos.push('As contas pagas não têm data de pagamento registrada: a pontualidade não pôde ser medida.')
  }

  metricas.saude = avaliarSaude(metricas, comDatas)
  return metricas
}

// ─── Último mês fechado vs. o normal ─────────────────────────────────────────

interface AgregadoMes {
  compras: number
  quantidade: number
  parcelas: number
  parcelasQtd: number
  micro: number
  microQtd: number
  parceladas: number
  financiado: number
  fimDeSemana: number
  categorias: Map<string, number>
  lugares: Map<string, { rotulo: string; quantidade: number; total: number }>
}

/**
 * O último mês fechado contra os 6 anteriores, pelo mês da fatura (a fatura
 * paga no mês). Vai junto a lista completa das linhas dessas faturas, cada
 * uma marcada como compra nova ou parcela em andamento.
 */
function calcularMesFoco(
  fechados: string[],
  transacoes: Transacao[],
  mensal: MesComportamento[],
): MesFoco {
  const mes = fechados[fechados.length - 1]
  const mesesBase = fechados.slice(0, -1)
  const agregados = new Map<string, AgregadoMes>(fechados.map(m => [m, {
    compras: 0, quantidade: 0, parcelas: 0, parcelasQtd: 0, micro: 0, microQtd: 0,
    parceladas: 0, financiado: 0, fimDeSemana: 0, categorias: new Map(), lugares: new Map(),
  }]))
  const lancamentos: LancamentoFatura[] = []

  for (const t of transacoes) {
    const a = agregados.get(t.projeto_fatura.substring(0, 7))
    if (!a) continue
    const parcela = parcelaDe(t)
    const nova = ehCompraNova(t)
    if (t.projeto_fatura.startsWith(mes)) {
      lancamentos.push({
        data: (t.data ?? '').substring(0, 10),
        descricao: (t.descricao_personalizada || t.descricao || '').slice(0, 60),
        categoria: t.categoria || 'Sem categoria',
        responsavel: t.responsavel || '',
        cartao: t.cartao ?? 'nubank',
        valor: r2(t.valor),
        parcela: parcela && parcela.total > 1 ? `${parcela.atual}/${parcela.total}` : null,
        tipo: nova ? 'compra_nova' : 'parcela_em_andamento',
      })
    }
    if (!nova) {
      a.parcelas += t.valor
      a.parcelasQtd += 1
      continue
    }
    const valor = valorDaCompra(t)
    a.compras += valor
    a.quantidade += 1
    if (valor <= LIMITE_MICROGASTO) { a.micro += valor; a.microQtd += 1 }
    if (ehParcelada(t)) { a.parceladas += 1; a.financiado += valor }
    const dia = lerData(t.data)?.getDay()
    if (dia === 0 || dia === 6) a.fimDeSemana += valor
    const cat = t.categoria || 'Sem categoria'
    a.categorias.set(cat, (a.categorias.get(cat) ?? 0) + valor)
    const { chave, rotulo } = chaveEstabelecimento(t)
    const lugar = a.lugares.get(chave) ?? { rotulo, quantidade: 0, total: 0 }
    lugar.quantidade += 1
    lugar.total += valor
    a.lugares.set(chave, lugar)
  }
  lancamentos.sort((x, y) => x.data.localeCompare(y.data) || y.valor - x.valor)

  const atual = agregados.get(mes)!
  // Meses sem nenhuma compra (antes de o app ser usado) não são "normal".
  const base = mesesBase.map(m => agregados.get(m)!).filter(a => a.quantidade + a.parcelasQtd > 0)
  const comCompra = base.filter(a => a.quantidade > 0)
  const comparar = (f: (a: AgregadoMes) => number, blocos = base): Comparativo => {
    const valorBase = media(blocos.map(f))
    return { atual: r2(f(atual)), base: r2(valorBase), variacaoPct: blocos.length ? variacao(f(atual), valorBase) : null }
  }
  const serie = new Map(mensal.map(m => [m.mes, m]))
  const mensalBase = mesesBase.map(m => serie.get(m)).filter((m): m is MesComportamento => !!m)
  const compararSerie = (f: (m: MesComportamento) => number, meses = mensalBase): Comparativo => {
    const valorAtual = serie.get(mes) ? f(serie.get(mes)!) : 0
    const valorBase = media(meses.map(f))
    return { atual: r2(valorAtual), base: r2(valorBase), variacaoPct: meses.length ? variacao(valorAtual, valorBase) : null }
  }
  const comReceita = mensalBase.filter(m => m.receita > 0)
  const temReceita = comReceita.length > 0 || (serie.get(mes)?.receita ?? 0) > 0

  const nomesCategorias = new Set([...atual.categorias.keys(), ...base.flatMap(a => [...a.categorias.keys()])])
  const categorias = [...nomesCategorias]
    .map(categoria => ({ categoria, ...comparar(a => a.categorias.get(categoria) ?? 0) }))
    .filter(c => c.atual > 0 || c.base > 0)
    .sort((a, b) => Math.max(b.atual, b.base) - Math.max(a.atual, a.base))
    .slice(0, 10)

  const estabelecimentos = [...atual.lugares.entries()]
    .sort((a, b) => b[1].quantidade - a[1].quantidade || b[1].total - a[1].total)
    .slice(0, 8)
    .map(([chave, l]) => ({
      nome: l.rotulo,
      quantidade: l.quantidade,
      total: r2(l.total),
      quantidadeBase: r1(media(base.map(a => a.lugares.get(chave)?.quantidade ?? 0))),
    }))

  const novidades = base.length === 0 ? [] : [
    ...[...atual.categorias.entries()]
      .filter(([c, v]) => v >= 50 && base.every(a => !a.categorias.has(c)))
      .map(([c]) => `Categoria ${c}`),
    ...[...atual.lugares.entries()]
      .filter(([chave, l]) => (l.total >= 100 || l.quantidade >= 2) && base.every(a => !a.lugares.has(chave)))
      .sort((a, b) => b[1].total - a[1].total)
      .map(([, l]) => l.rotulo),
  ].slice(0, 6)

  return {
    mes,
    mesesBase: base.length,
    compras: {
      valor: comparar(a => a.compras),
      quantidade: comparar(a => a.quantidade),
      ticketMedio: comparar(a => (a.quantidade ? a.compras / a.quantidade : 0), comCompra),
    },
    parcelasEmAndamento: { valor: comparar(a => a.parcelas), quantidade: atual.parcelasQtd },
    faturas: compararSerie(m => m.gastoCartao),
    contas: compararSerie(m => m.contas),
    receita: temReceita ? compararSerie(m => m.receita, comReceita) : null,
    saldo: temReceita ? compararSerie(m => m.saldo, comReceita) : null,
    microgastos: { valor: comparar(a => a.micro), quantidade: comparar(a => a.microQtd) },
    novosParcelamentos: { quantidade: comparar(a => a.parceladas), valorFinanciado: comparar(a => a.financiado) },
    fimDeSemanaPctValor: comparar(a => (a.compras > 0 ? (a.fimDeSemana / a.compras) * 100 : 0), comCompra),
    categorias,
    estabelecimentos,
    novidades,
    lancamentos,
  }
}

// ─── Nota de saúde financeira ────────────────────────────────────────────────

/** Interpola linearmente: `bom` vale 100, `ruim` vale 0. */
function escala(valor: number, bom: number, ruim: number): number {
  if (bom === ruim) return 100
  return Math.round(limitar(((valor - ruim) / (bom - ruim)) * 100))
}

/**
 * Nota 0–100 calculada por regra fixa, não pela IA: o mesmo dado sempre dá a
 * mesma nota, e dá para comparar uma análise com a próxima.
 */
function avaliarSaude(m: MetricasComportamento, contasComDatas: number): MetricasComportamento['saude'] {
  const ind: Array<IndicadorSaude & { peso: number }> = []
  const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

  if (m.resumo.taxaPoupancaMedia !== null) {
    ind.push({
      chave: 'poupanca', nome: 'Taxa de poupança', peso: 30,
      nota: escala(m.resumo.taxaPoupancaMedia, 20, 0),
      medida: `${fmtPct(m.resumo.taxaPoupancaMedia)} da receita sobra`,
      referencia: '20% ou mais é saudável',
    })
    const comReceita = m.mensal.filter(x => !x.parcial && x.receita > 0).length
    if (comReceita > 0) {
      ind.push({
        chave: 'vermelho', nome: 'Meses no vermelho', peso: 15,
        nota: escala(m.resumo.mesesNoVermelho / comReceita, 0, 0.5),
        medida: `${m.resumo.mesesNoVermelho} de ${comReceita} meses`,
        referencia: 'nenhum mês gastando mais do que entrou',
      })
    }
  }
  if (m.parcelamentos.pctReceitaProximoMes !== null) {
    ind.push({
      chave: 'parcelas', nome: 'Renda comprometida com parcelas', peso: 20,
      nota: escala(m.parcelamentos.pctReceitaProximoMes, 10, 40),
      medida: `${fmtPct(m.parcelamentos.pctReceitaProximoMes)} da receita no próximo mês`,
      referencia: 'até 10–15% da receita',
    })
  }
  if (m.periodo.mesesFechados >= 3 && m.resumo.gastoMedio > 0) {
    ind.push({
      chave: 'estabilidade', nome: 'Estabilidade dos gastos', peso: 10,
      nota: escala(m.resumo.oscilacaoGastoPct, 10, 50),
      medida: `oscilação de ${fmtPct(m.resumo.oscilacaoGastoPct)} entre meses`,
      referencia: 'até 10% de oscilação',
    })
  }
  if (m.resumo.tendenciaGastoPct !== null) {
    ind.push({
      chave: 'tendencia', nome: 'Tendência dos gastos', peso: 5,
      nota: escala(m.resumo.tendenciaGastoPct, 0, 25),
      medida: `${m.resumo.tendenciaGastoPct > 0 ? '+' : ''}${fmtPct(m.resumo.tendenciaGastoPct)} nos últimos 3 meses`,
      referencia: 'estável ou em queda',
    })
  }
  if (contasComDatas > 0) {
    ind.push({
      chave: 'pontualidade', nome: 'Pontualidade nas contas', peso: 10,
      nota: escala(m.planejamento.pagasComAtraso / contasComDatas, 0, 0.3),
      medida: `${m.planejamento.pagasComAtraso} de ${contasComDatas} contas com data de pagamento foram pagas com atraso`,
      referencia: 'todas em dia',
    })
  }
  if (m.planejamento.aderenciaPct !== null) {
    ind.push({
      chave: 'orcamento', nome: 'Disciplina com o orçamento', peso: 10,
      nota: escala(m.planejamento.aderenciaPct, 100, 130),
      medida: `realizado = ${fmtPct(m.planejamento.aderenciaPct)} do previsto`,
      referencia: 'até 100% do previsto',
    })
  }

  const pesoTotal = soma(ind.map(i => i.peso))
  const nota = pesoTotal > 0 ? Math.round(soma(ind.map(i => i.nota * i.peso)) / pesoTotal) : 0
  return {
    nota,
    indicadores: ind.map(i => ({ chave: i.chave, nome: i.nome, nota: i.nota, medida: i.medida, referencia: i.referencia })),
  }
}
