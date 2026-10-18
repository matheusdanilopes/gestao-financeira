/**
 * PDF visual da Análise de Comportamento.
 *
 * Segue a ordem da tela: nota com a conta dos indicadores, os números do
 * período (com a tabela mês a mês para conferir), o próximo mês, a leitura da
 * IA e o plano de ação; gráficos e detalhes vêm depois. Os gráficos são os
 * mesmos da tela (Chart.js renderizado fora da tela e colado como imagem). A
 * lista de lançamentos vai num apêndice em tabela.
 */

import { format } from 'date-fns'
import type { ChartConfiguration } from 'chart.js'
import type { jsPDF as JsPDF } from 'jspdf'
import { formatBRL } from '@/lib/format'
import { rotuloMesIso, rotuloEscopo } from './documento'
import {
  corDaRampa,
  graficoCategorias,
  graficoReceitaGasto,
  graficoSaldo,
} from './graficos'
import type { Comparativo, ResultadoAnalise } from './tipos'
import { OBJETIVOS_ANALISE, PESOS_SAUDE, destaqueCurto, rotuloJanela } from './tipos'

const A4_H = 297
const MX = 14
const W = 182
const PX_POR_MM = 4

type RGB = [number, number, number]
const TINTA: RGB = [15, 23, 42]
const CINZA: RGB = [100, 116, 139]
const CINZA_CLARO: RGB = [226, 232, 240]
const FUNDO: RGB = [248, 250, 252]
const VIOLETA: RGB = [124, 58, 237]
const VERDE: RGB = [22, 163, 74]
const AMBAR: RGB = [217, 119, 6]
const VERMELHO: RGB = [220, 38, 38]
const AZUL: RGB = [42, 120, 214]

function corDaNota(n: number): RGB {
  return n >= 75 ? VERDE : n >= 50 ? AMBAR : VERMELHO
}

function rotuloNota(n: number): string {
  return n >= 85 ? 'Excelente' : n >= 75 ? 'Saudável' : n >= 50 ? 'Atenção' : n >= 30 ? 'Frágil' : 'Crítica'
}

/** As fontes padrão do PDF só têm o alfabeto latino (WinAnsi): troca o resto. */
function limpar(t: string): string {
  return t
    .replace(/[−‒]/g, '-')
    .replace(/[≈∼]/g, '~')
    .replace(/[→⇒]/g, '->')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[^\u0000-ÿ–—‘’“”•…€]/g, '')
}

/** Renderiza uma configuração Chart.js num canvas fora da tela e devolve PNG. */
async function graficoComoImagem(config: ChartConfiguration<'bar'>, larguraMm: number, alturaMm: number): Promise<string> {
  const { Chart, BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip } = await import('chart.js')
  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip)

  const canvas = document.createElement('canvas')
  const largura = Math.round(larguraMm * PX_POR_MM)
  const altura = Math.round(alturaMm * PX_POR_MM)
  canvas.width = largura
  canvas.height = altura
  canvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${largura}px;height:${altura}px`
  document.body.appendChild(canvas)
  try {
    const grafico = new Chart(canvas, {
      ...config,
      options: { ...config.options, responsive: false, animation: false, devicePixelRatio: 2 },
      // Fundo branco: sobre PNG transparente as linhas antisserrilhadas saem
      // escuras no PDF.
      plugins: [...(config.plugins ?? []), {
        id: 'fundoBranco',
        beforeDraw: c => {
          c.ctx.save()
          c.ctx.fillStyle = '#ffffff'
          c.ctx.fillRect(0, 0, c.width, c.height)
          c.ctx.restore()
        },
      }],
    })
    const png = grafico.toBase64Image('image/png', 1)
    grafico.destroy()
    return png
  } finally {
    canvas.remove()
  }
}

export async function exportarAnalisePdf(r: ResultadoAnalise): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')
  const doc: JsPDF = new jsPDF()
  const { analise: a, metricas: m, parametros: p } = r
  const tema = { escuro: false, rotulos: true }
  let y = 16

  const cor = (c: RGB) => doc.setTextColor(c[0], c[1], c[2])
  const preencher = (c: RGB) => doc.setFillColor(c[0], c[1], c[2])
  const traco = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2])
  const fonte = (tamanho: number, estilo: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', estilo)
    doc.setFontSize(tamanho)
  }
  /** Escreve texto quebrado em linhas e devolve a altura usada (mm). */
  const paragrafo = (texto: string, x: number, topo: number, largura: number, tamanho: number, estilo: 'normal' | 'bold' = 'normal', c: RGB = TINTA) => {
    fonte(tamanho, estilo)
    cor(c)
    const linhas = doc.splitTextToSize(limpar(texto), largura) as string[]
    const alturaLinha = tamanho * 0.42
    doc.text(linhas, x, topo + tamanho * 0.3, { baseline: 'top', lineHeightFactor: 1.25 })
    return linhas.length * alturaLinha * 1.25
  }
  const garantir = (altura: number) => {
    if (y + altura > A4_H - 14) {
      doc.addPage()
      y = 16
    }
  }
  /** Título de seção; `conteudo` = altura do que vem logo abaixo, para não ficar órfão. */
  const titulo = (texto: string, conteudo = 0) => {
    garantir(14 + conteudo)
    fonte(12, 'bold')
    cor(TINTA)
    doc.text(limpar(texto), MX, y + 4)
    preencher(VIOLETA)
    doc.rect(MX, y + 6.5, 10, 0.8, 'F')
    y += 11
  }
  const imagem = async (config: ChartConfiguration<'bar'> | null, altura: number, x = MX, largura = W) => {
    if (!config) return 0
    const png = await graficoComoImagem(config, largura, altura)
    // Sem compressão o jsPDF guarda o PNG decodificado: 20 MB para 5 gráficos.
    doc.addImage(png, 'PNG', x, y, largura, altura, undefined, 'FAST')
    return altura
  }

  // ── Cabeçalho ──
  const objetivo = OBJETIVOS_ANALISE.find(o => o.chave === p.objetivo)?.label ?? p.objetivo
  preencher(VIOLETA)
  doc.rect(0, 0, 210, 3, 'F')
  fonte(17, 'bold')
  cor(TINTA)
  doc.text('Análise de Comportamento Financeiro', MX, y + 5)
  y += 10
  const periodo = m.mesFoco
    ? `${rotuloMesIso(m.mesFoco.mes)} vs. ${m.mesFoco.mesesBase} meses anteriores`
    : `${rotuloMesIso(m.periodo.inicio)} a ${rotuloMesIso(m.periodo.fim)}`
  fonte(9)
  cor(CINZA)
  doc.text(limpar(`${rotuloJanela(p.janela)} · ${periodo} · ${rotuloEscopo(p.escopo)} · ${objetivo} · gerado em ${format(new Date(r.geradaEm), 'dd/MM/yyyy')}`), MX, y)
  y += 8

  // ── Nota + perfil ──
  const nota = m.saude.nota
  const corN = corDaNota(nota)
  const cx = MX + 15
  const cy = y + 15
  doc.setLineWidth(3)
  traco(CINZA_CLARO)
  doc.circle(cx, cy, 12.5, 'S')
  traco(corN)
  // Arco proporcional à nota: segmentos curtos com ponta redonda emendam lisos.
  doc.setLineCap('round')
  const passos = Math.max(1, Math.round(nota * 1.8))
  for (let i = 0; i < passos; i++) {
    const a0 = -Math.PI / 2 + (i / 180) * Math.PI * 2
    const a1 = -Math.PI / 2 + ((i + 1) / 180) * Math.PI * 2
    doc.line(cx + 12.5 * Math.cos(a0), cy + 12.5 * Math.sin(a0), cx + 12.5 * Math.cos(a1), cy + 12.5 * Math.sin(a1))
  }
  doc.setLineCap('butt')
  doc.setLineWidth(0.2)
  fonte(18, 'bold')
  cor(corN)
  doc.text(String(nota), cx, cy + 1.5, { align: 'center' })
  fonte(7)
  cor(CINZA)
  doc.text('de 100', cx, cy + 6, { align: 'center' })

  const xt = MX + 34
  const lt = W - 34
  let yt = y
  fonte(8, 'bold')
  cor(corN)
  doc.text(`SAÚDE FINANCEIRA · ${rotuloNota(nota).toUpperCase()}`, xt, yt + 2)
  yt += 5
  yt += paragrafo(a.manchete, xt, yt, lt, 11, 'bold')
  yt += 1
  yt += paragrafo(`${a.perfil.nome} — ${a.perfil.descricao}`, xt, yt, lt, 8.5, 'normal', VIOLETA)
  y = Math.max(y + 32, yt + 3)
  if (a.resumo) y += paragrafo(a.resumo.replace(/\n+/g, ' '), MX, y, W, 9, 'normal', CINZA) + 3

  /** Linhas de uma conta (+ / − / =), valor alinhado à direita. */
  const conta = (todas: Array<[string, number, '+' | '-' | '=']>) => {
    // Parcela zerada só alonga a conta; o resultado (=) aparece sempre.
    const linhas = todas.filter(([, valor, sinal]) => sinal === '=' || Math.abs(valor) >= 0.5)
    garantir(linhas.length * 5.5 + 2)
    for (const [rotulo, valor, sinal] of linhas) {
      if (sinal === '=') {
        traco(CINZA_CLARO)
        doc.line(MX, y, MX + W, y)
      }
      fonte(8.5, sinal === '=' ? 'bold' : 'normal')
      cor(sinal === '=' ? (valor < 0 ? VERMELHO : TINTA) : CINZA)
      doc.text(limpar(rotulo), MX, y + 3.6)
      // Resultado negativo já diz "Falta"/"Faltou" no rótulo: o valor vai sem sinal, em vermelho.
      const exibido = sinal === '=' && /^Falt/.test(rotulo) ? Math.abs(valor) : valor
      doc.text(limpar(`${sinal === '=' ? '' : `${sinal} `}${formatBRL(exibido)}`), MX + W, y + 3.6, { align: 'right' })
      y += 5.5
    }
    y += 2
  }
  const finalTabela = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // ── Indicadores de saúde: nota, medida e ideal de cada um, e a conta ──
  const ind = m.saude.indicadores.map(i => ({ ...i, peso: PESOS_SAUDE[i.chave] ?? 0 }))
  if (ind.length > 0) {
    titulo('O que forma a nota', 12)
    for (const i of ind) {
      garantir(11)
      fonte(8, 'bold')
      cor(TINTA)
      doc.text(limpar(i.nome), MX, y + 2.5)
      cor(corDaNota(i.nota))
      doc.text(String(i.nota), MX + W, y + 2.5, { align: 'right' })
      preencher(CINZA_CLARO)
      doc.roundedRect(MX, y + 4, W, 1.4, 0.7, 0.7, 'F')
      preencher(corDaNota(i.nota))
      doc.roundedRect(MX, y + 4, Math.max(1.4, (W * i.nota) / 100), 1.4, 0.7, 0.7, 'F')
      fonte(7)
      cor(CINZA)
      doc.text(limpar(`${i.medida} · ideal: ${i.referencia} · peso ${i.peso}`), MX, y + 8.6)
      y += 11
    }
    const pesoTotal = ind.reduce((s, i) => s + i.peso, 0)
    const pontos = ind.reduce((s, i) => s + i.nota * i.peso, 0)
    if (pesoTotal > 0) {
      y += paragrafo(
        `Como calculei: a nota é calculada pelo app, não pela IA. Cada indicador vale 100 no ideal e cai até 0 conforme se afasta dele; a nota geral é a média ponderada pelos pesos: soma de nota × peso (${pontos}) ÷ soma dos pesos (${pesoTotal}) = ${(pontos / pesoTotal).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.`,
        MX, y, W, 7.5, 'normal', CINZA,
      ) + 4
    }
  }

  // ── Mês em foco: a conta do saldo e as barras mês × normal ──
  if (m.mesFoco) {
    const f = m.mesFoco
    titulo(`${rotuloMesIso(f.mes)} vs. seu normal`, 8 * 6 + 8)
    if (f.saldo && f.receita) {
      conta([
        ['Receita', f.receita.atual, '+'],
        ['Faturas do cartão', f.faturas.atual, '-'],
        ['Contas', f.contas.atual, '-'],
        [f.saldo.atual < 0 ? 'Faltou no mês' : 'Sobrou no mês', f.saldo.atual, '='],
      ])
    }
    const linhas: Array<[string, Comparativo]> = [
      ...(f.receita ? [['Receita', f.receita] as [string, Comparativo]] : []),
      ['Faturas do cartão', f.faturas],
      ['Contas do planejamento', f.contas],
      ['Compras novas no mês', f.compras.valor],
      ['Microgastos (até R$ 50)', f.microgastos.valor],
    ]
    const maximo = Math.max(...linhas.flatMap(([, c]) => [Math.abs(c.atual), Math.abs(c.base)]), 1)
    const xBarra = MX + 52
    const lBarra = W - 52 - 40
    for (const [rotulo, c] of linhas) {
      garantir(8)
      fonte(8)
      cor(TINTA)
      doc.text(rotulo, MX, y + 3.2)
      preencher(AZUL)
      doc.roundedRect(xBarra, y + 0.6, Math.max(1, (Math.abs(c.atual) / maximo) * lBarra), 2.4, 0.6, 0.6, 'F')
      preencher(CINZA_CLARO)
      doc.roundedRect(xBarra, y + 3.6, Math.max(1, (Math.abs(c.base) / maximo) * lBarra), 2.4, 0.6, 0.6, 'F')
      fonte(8, 'bold')
      doc.text(limpar(formatBRL(c.atual)), MX + W - 14, y + 2.8, { align: 'right' })
      const v = c.variacaoPct
      fonte(7.5, 'bold')
      cor(v === null || Math.abs(v) < 5 ? CINZA : v > 0 ? VERMELHO : VERDE)
      doc.text(v === null ? 'novo' : `${v > 0 ? '+' : ''}${Math.round(v)}%`, MX + W, y + 2.8, { align: 'right' })
      fonte(6.5)
      cor(CINZA)
      doc.text(limpar(`normal ${formatBRL(c.base)}`), MX + W - 14, y + 6, { align: 'right' })
      y += 8
    }
    y += paragrafo(
      `Azul: ${rotuloMesIso(f.mes)} · cinza: média de ${f.mesesBase} meses anteriores. Das faturas, ${formatBRL(f.parcelasEmAndamento.valor.atual)} são parcelas de compras antigas. Compras novas usam o valor cheio da compra (10× R$ 100 conta R$ 1.000), por isso não somam com as faturas.`,
      MX, y, W, 7, 'normal', CINZA,
    ) + 4
  }

  // ── Seus números: médias e a tabela mês a mês ──
  const fechados = m.mensal.filter(x => !x.parcial)
  const temReceita = fechados.some(x => x.receita > 0)
  titulo(`Seus números · média de ${fechados.length} ${fechados.length === 1 ? 'mês fechado' : 'meses fechados'}`, 30)
  const kpis: Array<[string, string, RGB]> = [
    ['Receita por mês', formatBRL(m.resumo.receitaMedia), TINTA],
    ['Gasto por mês', formatBRL(m.resumo.gastoMedio), TINTA],
    ...(temReceita
      ? [
          [m.resumo.saldoMedio >= 0 ? 'Sobra por mês' : 'Falta por mês', formatBRL(Math.abs(m.resumo.saldoMedio)), m.resumo.saldoMedio < 0 ? VERMELHO : VERDE] as [string, string, RGB],
          ['Meses no vermelho', `${m.resumo.mesesNoVermelho} de ${fechados.length}`, m.resumo.mesesNoVermelho > 0 ? VERMELHO : TINTA] as [string, string, RGB],
        ]
      : []),
  ]
  const lk = (W - 2 * (kpis.length - 1)) / kpis.length
  kpis.forEach(([rotulo, valor, c], i) => {
    const x = MX + i * (lk + 2)
    preencher(FUNDO)
    doc.roundedRect(x, y, lk, 16, 2, 2, 'F')
    fonte(7)
    cor(CINZA)
    doc.text(rotulo, x + 3, y + 5)
    fonte(11, 'bold')
    cor(c)
    doc.text(limpar(valor), x + 3, y + 12)
  })
  y += 20
  const mediaDe = (f: (x: typeof fechados[number]) => number) => fechados.reduce((s, x) => s + f(x), 0) / Math.max(1, fechados.length)
  autoTable(doc, {
    startY: y,
    head: [['Mês', 'Receita', 'Cartão', 'Contas', 'Saldo']],
    body: fechados.map(x => [rotuloMesIso(x.mes), formatBRL(x.receita), formatBRL(x.gastoCartao), formatBRL(x.contas), formatBRL(x.saldo)]),
    foot: [['Média', formatBRL(mediaDe(x => x.receita)), formatBRL(mediaDe(x => x.gastoCartao)), formatBRL(mediaDe(x => x.contas)), formatBRL(mediaDe(x => x.saldo))]],
    margin: { left: MX, right: MX },
    styles: { fontSize: 7.5, cellPadding: 1.2 },
    headStyles: { fillColor: VIOLETA, fontSize: 7.5 },
    footStyles: { fillColor: FUNDO, textColor: TINTA, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: FUNDO },
    // Cabeçalho e média alinhados com os valores (columnStyles só vale para o corpo).
    didParseCell: d => { if (d.column.index > 0) d.cell.styles.halign = 'right' },
  })
  y = finalTabela() + 3
  const receitaTotal = fechados.reduce((s, x) => s + x.receita, 0)
  const gastoTotal = fechados.reduce((s, x) => s + x.gastoTotal, 0)
  y += paragrafo(
    'Como calculei: a mesma conta do Dashboard. Cartão = valor pago da fatura do mês (sem pagamento marcado, a soma das compras); contas = despesas do planejamento, sem a linha da fatura; receita = a recebida (sem a marcação, a prevista); saldo = receita - cartão - contas.'
      + (temReceita && m.resumo.taxaPoupancaMedia !== null
        ? ` % da receita que sobra = ${formatBRL(receitaTotal - gastoTotal)} ÷ ${formatBRL(receitaTotal)} = ${m.resumo.taxaPoupancaMedia.toLocaleString('pt-BR')}%.`
        : '')
      + ' O mês atual fica fora das médias.',
    MX, y, W, 7, 'normal', CINZA,
  ) + 5

  // ── Próximo mês ──
  if (m.proximoMes) {
    const pm = m.proximoMes
    titulo(`${rotuloMesIso(pm.mes)}: quanto vai sobrar`, 50)
    conta([
      [`Receita (${pm.receitaFonte === 'planejada' ? 'planejada' : 'média'})`, pm.receita, '+'],
      ['Contas', pm.contas, '-'],
      ['Parcelas já contratadas', pm.parcelas, '-'],
      ...(pm.assinaturas > 0 ? [['Assinaturas', pm.assinaturas, '-'] as [string, number, '-']] : []),
      ['Livre para o mês', pm.margemLivre, '='],
      ['Gasto típico em compras novas e extras', pm.variavelHabitual, '-'],
      [pm.folga >= 0 ? 'Sobra prevista' : 'Falta prevista', pm.folga, '='],
    ])
    y += paragrafo(
      pm.margemLivre > 0
        ? `Para não fechar no vermelho: até ${formatBRL(pm.tetoSemanal)} por semana em compras novas e extras (livre para o mês ÷ semanas do mês).`
        : 'As contas e parcelas já passam da receita: qualquer compra nova aumenta o saldo negativo.',
      MX, y, W, 8, 'normal', TINTA,
    ) + 5
  }

  // ── Padrões em cartões ──
  if (a.padroes.length > 0) {
    titulo('O que os dados mostram (leitura da IA)', 30)
    const lc = (W - 4) / 2
    for (let k = 0; k < a.padroes.length; k += 2) {
      const par = a.padroes.slice(k, k + 2)
      const alturas = par.map(pd => {
        fonte(8)
        const linhas = (doc.splitTextToSize(limpar(pd.descricao), lc - 8) as string[]).length
        const linhasTitulo = (doc.splitTextToSize(limpar(pd.titulo), lc - 8) as string[]).length
        return 15 + linhasTitulo * 4 + linhas * 3.6
      })
      const h = Math.max(...alturas)
      garantir(h + 3)
      par.forEach((pd, i) => {
        const x = MX + i * (lc + 4)
        const c = pd.impacto === 'negativo' ? VERMELHO : pd.impacto === 'positivo' ? VERDE : TINTA
        preencher(FUNDO)
        doc.roundedRect(x, y, lc, h, 2.5, 2.5, 'F')
        preencher(c)
        doc.rect(x, y + 3, 0.9, h - 6, 'F')
        fonte(15, 'bold')
        cor(c)
        doc.text(limpar(destaqueCurto(pd.destaque) || '•'), x + 4, y + 8)
        let yy = y + 11
        yy += paragrafo(pd.titulo, x + 4, yy, lc - 8, 9, 'bold')
        paragrafo(pd.descricao, x + 4, yy + 0.5, lc - 8, 8, 'normal', CINZA)
      })
      y += h + 3
    }
    y += 2
  }

  // ── Plano de ação: cada ação com a sua economia ──
  const economia = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)
  if (a.planoDeAcao.length > 0) {
    titulo('Plano de ação', economia > 0 ? 24 : 12)
    if (economia > 0) {
      fonte(18, 'bold')
      cor(VERDE)
      doc.text(limpar(formatBRL(economia)), MX, y + 6)
      const lEco = doc.getTextWidth(limpar(formatBRL(economia)))
      fonte(9)
      cor(CINZA)
      doc.text(limpar(`por mês, se seguir o plano · ${formatBRL(economia * 12)} por ano`), MX + lEco + 3, y + 6)
      y += 11
    }
    a.planoDeAcao.forEach((acao, i) => {
      fonte(8)
      const h = 6.5 + (doc.splitTextToSize(limpar(acao.porque), W - 40) as string[]).length * 3.8
      garantir(h + 2)
      preencher([238, 242, 255])
      doc.roundedRect(MX, y, 6, 6, 1.2, 1.2, 'F')
      fonte(8, 'bold')
      cor(VIOLETA)
      doc.text(String(i + 1), MX + 3, y + 4.2, { align: 'center' })
      fonte(9, 'bold')
      cor(TINTA)
      doc.text(limpar(acao.acao), MX + 9, y + 3.6)
      if (acao.economiaMensal > 0) {
        fonte(8.5, 'bold')
        cor(VERDE)
        doc.text(limpar(`-${formatBRL(acao.economiaMensal)}/mês`), MX + W, y + 3.6, { align: 'right' })
      }
      fonte(7)
      cor(CINZA)
      doc.text(limpar(acao.prazo), MX + W, y + 7.6, { align: 'right' })
      paragrafo(acao.porque, MX + 9, y + 4.6, W - 40, 8, 'normal', CINZA)
      y += h + 2
    })
    if (economia > 0) {
      y += paragrafo(
        `Como calculei: a economia de cada ação é uma estimativa da IA a partir da média mensal do gasto que ela ataca. O app limita as ações de uma categoria ao que ela gasta por mês, e o total a metade do gasto que se decide no dia a dia.${a.economiaAjustada ? ' Nesta análise as estimativas foram reduzidas para caber nesses limites.' : ''}`,
        MX, y, W, 7, 'normal', CINZA,
      ) + 3
    }
    y += 2
  }

  // ── Metas ──
  if (a.metas.length > 0) {
    titulo('Metas para acompanhar', 22)
    const lm = (W - 4 * (a.metas.length - 1)) / a.metas.length
    // Altura pelo texto mais longo: meta em duas linhas não pode cobrir o prazo.
    fonte(7.5, 'bold')
    const linhasMeta = Math.max(...a.metas.map(meta => (doc.splitTextToSize(limpar(meta.meta), lm - 6) as string[]).length))
    const hm = 15 + linhasMeta * 3.9
    garantir(hm + 5)
    a.metas.forEach((meta, i) => {
      const x = MX + i * (lm + 4)
      preencher(FUNDO)
      doc.roundedRect(x, y, lm, hm, 2.5, 2.5, 'F')
      fonte(11, 'bold')
      cor(AZUL)
      doc.text(limpar(meta.alvo), x + 3, y + 6.5, { maxWidth: lm - 6 })
      paragrafo(meta.meta, x + 3, y + 9, lm - 6, 7.5, 'bold')
      fonte(6.5)
      cor(CINZA)
      doc.text(limpar(meta.prazo), x + 3, y + hm - 1.5)
    })
    y += hm + 5
  }

  // ── Detalhes ──
  garantir(80)
  y += 4
  fonte(14, 'bold')
  cor(TINTA)
  doc.text('Detalhes', MX, y + 4)
  y += 10

  titulo('Receita × gasto', 55)
  y += await imagem(graficoReceitaGasto(m, tema), 55)
  y += 3
  if (temReceita) {
    titulo('Quanto sobrou por mês', 45)
    y += await imagem(graficoSaldo(m, tema), 45)
    y += 3
  }

  if (m.fixoVariavel) {
    const fv = m.fixoVariavel
    titulo(`Fixo × variável · ${fv.pctFixo.toLocaleString('pt-BR')}% já vem comprometido`, 40)
    conta([
      ['Contas recorrentes', fv.fixo.contas, '+'],
      ['Parcelas de compras antigas', fv.fixo.parcelas, '+'],
      ['Assinaturas', fv.fixo.assinaturas, '+'],
      ['Fixo', fv.fixo.total, '='],
      ['Compras novas no cartão', fv.variavel.cartao, '+'],
      ['Diferença fatura paga × compras (estornos, juros)', fv.variavel.ajusteFatura ?? 0, '+'],
      ['Contas fora da rotina', fv.variavel.contas, '+'],
      ['Variável', fv.variavel.total, '='],
    ])
    y += paragrafo(
      `Fixo + variável = ${formatBRL(fv.fixo.total + fv.variavel.total)}, o mesmo gasto por mês de "Seus números".`,
      MX, y, W, 7, 'normal', CINZA,
    ) + 4
  }

  const cfgCat = graficoCategorias(m, tema)
  if (cfgCat) {
    titulo(m.mesFoco ? 'Categorias: compras novas do mês × o normal' : 'Categorias: últimos 3 meses × anteriores', 70)
    y += await imagem(cfgCat, 70)
    y += 3
  }

  const mapa = m.quando.mapaCalor
  if (mapa) {
    titulo('Quando vocês compram', mapa.dias.length * 7 + 14)
    const maximo = Math.max(...mapa.quantidade.flat(), 1)
    const xm = MX + 12
    const lcel = (W - 12 - 22) / mapa.fases.length
    fonte(7)
    cor(CINZA)
    mapa.fases.forEach((f, j) => doc.text(f, xm + j * lcel + lcel / 2, y + 2, { align: 'center' }))
    y += 4
    const totalDia = mapa.quantidade.map(l => l.reduce((s, q) => s + q, 0))
    const maxDia = Math.max(...totalDia, 1)
    mapa.dias.forEach((dia, i) => {
      fonte(7.5)
      cor(CINZA)
      doc.text(dia, MX, y + 4.2)
      mapa.quantidade[i].forEach((q, j) => {
        const hex = corDaRampa(q, maximo)
        const rgb: RGB = hex
          ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
          : FUNDO
        preencher(rgb)
        doc.roundedRect(xm + j * lcel + 0.5, y, lcel - 1, 6, 1, 1, 'F')
        if (q > 0) {
          fonte(7, 'bold')
          if (q / maximo > 0.5) doc.setTextColor(255, 255, 255)
          else cor(TINTA)
          doc.text(String(q), xm + j * lcel + lcel / 2, y + 4, { align: 'center' })
        }
      })
      preencher([134, 182, 239])
      doc.roundedRect(MX + W - 20, y + 2.2, Math.max(0.8, (totalDia[i] / maxDia) * 14), 1.6, 0.8, 0.8, 'F')
      fonte(6.5)
      cor(CINZA)
      doc.text(String(totalDia[i]), MX + W, y + 4, { align: 'right' })
      y += 7
    })
    fonte(7)
    cor(CINZA)
    doc.text('Quantidade de compras novas por dia da semana × dias do mês (sem parcelas de compras antigas).', MX, y + 2)
    y += 8
  }

  // ── Gatilhos · Riscos · Pontos fortes (3 colunas) ──
  const colunas = ([
    ['Gatilhos', AMBAR, a.gatilhos],
    ['Riscos', VERMELHO, a.riscos],
    ['Pontos fortes', VERDE, a.pontosFortes],
  ] as Array<[string, RGB, Array<{ titulo: string; descricao: string }>]>).filter(([, , itens]) => itens.length > 0)
  if (colunas.length > 0) {
    const l3 = (W - 4 * (colunas.length - 1)) / colunas.length
    const alturaColuna = (itens: Array<{ titulo: string; descricao: string }>) => itens.reduce((s, it) => {
      fonte(7.5)
      const lt1 = (doc.splitTextToSize(limpar(it.titulo), l3 - 6) as string[]).length
      const ld = (doc.splitTextToSize(limpar(it.descricao), l3 - 6) as string[]).length
      return s + lt1 * 3.8 + ld * 3.4 + 3
    }, 10)
    const h3 = Math.max(...colunas.map(([, , itens]) => alturaColuna(itens)))
    garantir(h3 + 4)
    colunas.forEach(([nome, c, itens], i) => {
      const x = MX + i * (l3 + 4)
      preencher(FUNDO)
      doc.roundedRect(x, y, l3, h3, 2.5, 2.5, 'F')
      fonte(9, 'bold')
      cor(c)
      doc.text(nome, x + 3, y + 6)
      let yy = y + 9
      for (const it of itens) {
        yy += paragrafo(it.titulo, x + 3, yy, l3 - 6, 7.5, 'bold')
        yy += paragrafo(it.descricao, x + 3, yy, l3 - 6, 7, 'normal', CINZA) + 3
      }
    })
    y += h3 + 6
  }

  // ── Perguntas e limites ──
  if (a.perguntas.length > 0) {
    titulo('Para refletir', 12)
    for (const q of a.perguntas) {
      garantir(10)
      preencher([199, 210, 254])
      doc.rect(MX, y, 0.8, 5, 'F')
      y += paragrafo(q, MX + 3, y, W - 3, 8.5, 'normal', TINTA) + 2.5
    }
  }
  const avisos = [...m.qualidade.avisos, ...a.limitacoes]
  if (avisos.length > 0) {
    y += 3
    garantir(12)
    y += paragrafo(`Limites: ${avisos.join(' ')}`, MX, y, W, 7, 'normal', CINZA)
  }
  y += 2
  garantir(6)
  paragrafo('Números calculados pelo app; interpretação gerada por IA a partir deles.', MX, y, W, 7, 'normal', CINZA)

  // ── Apêndice: lançamentos do mês ──
  if (m.mesFoco && m.mesFoco.lancamentos.length > 0) {
    doc.addPage()
    y = 16
    titulo(`Apêndice: lançamentos das faturas de ${rotuloMesIso(m.mesFoco.mes)}`)
    paragrafo('Parcelas em andamento entram com a data de abertura da fatura — não são compras novas.', MX, y - 2, W, 7.5, 'normal', CINZA)
    autoTable(doc, {
      startY: y + 3,
      head: [['Data', 'Descrição', 'Categoria', 'Resp.', 'Tipo', 'Valor']],
      body: m.mesFoco.lancamentos.map(l => [
        l.data.split('-').reverse().join('/').slice(0, 5),
        limpar(l.descricao),
        limpar(l.categoria),
        l.responsavel,
        l.tipo === 'compra_nova' ? (l.parcela ? `Nova (${l.parcela})` : 'Nova') : `Parcela ${l.parcela ?? ''}`,
        formatBRL(l.valor),
      ]),
      margin: { left: MX, right: MX },
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: VIOLETA, fontSize: 7.5 },
      alternateRowStyles: { fillColor: FUNDO },
      columnStyles: { 5: { halign: 'right' } },
    })
  }

  // Rodapé com paginação.
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    fonte(7)
    cor(CINZA)
    doc.text(`${i}/${paginas}`, MX + W, A4_H - 7, { align: 'right' })
  }

  doc.save(`analise-comportamento-${r.geradaEm.substring(0, 10)}.pdf`)
}
