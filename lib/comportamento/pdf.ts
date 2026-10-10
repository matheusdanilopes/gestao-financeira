/**
 * PDF visual da Análise de Comportamento.
 *
 * O PDF genérico dos relatórios é feito de tabelas — bom para números, cansativo
 * para uma análise. Este monta páginas visuais: nota em destaque, indicadores
 * em barras, os mesmos gráficos da tela (Chart.js renderizado fora da tela e
 * colado como imagem), padrões em cartões com o número-chave e o plano de ação
 * enxuto. A lista de lançamentos vai num apêndice em tabela.
 */

import { format } from 'date-fns'
import type { ChartConfiguration } from 'chart.js'
import type { jsPDF as JsPDF } from 'jspdf'
import { formatBRL } from '@/lib/format'
import { rotuloMesIso, rotuloEscopo } from './documento'
import {
  corDaRampa,
  graficoCategorias,
  graficoPlano,
  graficoReceitaGasto,
  graficoSaldo,
} from './graficos'
import type { Comparativo, ResultadoAnalise } from './tipos'
import { OBJETIVOS_ANALISE, rotuloJanela } from './tipos'

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

  // ── KPIs ──
  const economia = a.planoDeAcao.reduce((s, x) => s + x.economiaMensal, 0)
  const kpis: Array<[string, string, RGB]> = [
    ['Receita média', formatBRL(m.resumo.receitaMedia), TINTA],
    ['Gasto médio', formatBRL(m.resumo.gastoMedio), TINTA],
    ['Taxa de poupança', m.resumo.taxaPoupancaMedia === null ? '-' : `${m.resumo.taxaPoupancaMedia.toLocaleString('pt-BR')}%`,
      (m.resumo.taxaPoupancaMedia ?? 0) < 0 ? VERMELHO : TINTA],
    ['Economia possível/mês', formatBRL(economia), VERDE],
  ]
  const lk = (W - 6) / 4
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
  y += 21

  // ── Indicadores de saúde (barras) ──
  const ind = m.saude.indicadores
  const li = (W - 8) / 2
  ind.forEach((i, k) => {
    const x = MX + (k % 2) * (li + 8)
    const yy = y + Math.floor(k / 2) * 9
    fonte(7.5)
    cor(TINTA)
    doc.text(limpar(i.nome), x, yy + 2.5)
    fonte(7.5, 'bold')
    cor(corDaNota(i.nota))
    doc.text(String(i.nota), x + li, yy + 2.5, { align: 'right' })
    preencher(CINZA_CLARO)
    doc.roundedRect(x, yy + 4, li, 1.6, 0.8, 0.8, 'F')
    preencher(corDaNota(i.nota))
    doc.roundedRect(x, yy + 4, Math.max(1.6, (li * i.nota) / 100), 1.6, 0.8, 0.8, 'F')
  })
  y += Math.ceil(ind.length / 2) * 9 + 4

  // ── Gráficos de mês a mês ──
  titulo('Receita × gasto', 55)
  y += await imagem(graficoReceitaGasto(m, tema), 55)
  y += 3
  if (m.mensal.some(x => !x.parcial && x.receita > 0)) {
    titulo('Quanto sobrou por mês', 45)
    y += await imagem(graficoSaldo(m, tema), 45)
    y += 3
  }

  // ── Padrões em cartões ──
  titulo('O que os dados mostram', 30)
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
      doc.text(limpar(pd.destaque || '•'), x + 4, y + 8)
      let yy = y + 11
      yy += paragrafo(pd.titulo, x + 4, yy, lc - 8, 9, 'bold')
      paragrafo(pd.descricao, x + 4, yy + 0.5, lc - 8, 8, 'normal', CINZA)
    })
    y += h + 3
  }
  y += 2

  // ── Mês em foco: barras mês × normal ──
  if (m.mesFoco) {
    const f = m.mesFoco
    titulo(`${rotuloMesIso(f.mes)} vs. seu normal`, 8 * 6 + 8)
    const linhas: Array<[string, Comparativo]> = [
      ['Total das faturas', f.faturas],
      ['Compras novas (valor cheio)', f.compras.valor],
      ['Parcelas de compras antigas', f.parcelasEmAndamento.valor],
      ['Contas do planejamento', f.contas],
      ...(f.receita ? [['Receita', f.receita] as [string, Comparativo]] : []),
      ['Microgastos (até R$ 50)', f.microgastos.valor],
    ]
    const maximo = Math.max(...linhas.flatMap(([, c]) => [Math.abs(c.atual), Math.abs(c.base)]), 1)
    const xBarra = MX + 52
    const lBarra = W - 52 - 40
    for (const [rotulo, c] of linhas) {
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
    fonte(7)
    cor(CINZA)
    doc.text(`Azul: ${rotuloMesIso(f.mes)} · cinza: média de ${f.mesesBase} meses anteriores`, MX, y + 2)
    y += 7
  }

  // ── Mapa de calor ──
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
    doc.text('Compras novas por dia da semana × fase do mês (sem parcelas em andamento). Mais escuro = mais compras.', MX, y + 2)
    y += 8
  }

  // ── Categorias ──
  const cfgCat = graficoCategorias(m, tema)
  if (cfgCat) {
    titulo(m.mesFoco ? 'Categorias: o mês × o normal' : 'Categorias: últimos 3 meses × anteriores', 70)
    y += await imagem(cfgCat, 70)
    y += 3
  }

  // ── Plano de ação ──
  const nAcoes = a.planoDeAcao.filter(x => x.economiaMensal > 0).length
  const alturaGraficoPlano = Math.max(28, nAcoes * 9 + 10)
  titulo('Plano de ação', economia > 0 ? alturaGraficoPlano + 14 : 12)
  if (economia > 0) {
    fonte(18, 'bold')
    cor(VERDE)
    doc.text(limpar(formatBRL(economia)), MX, y + 6)
    const lEco = doc.getTextWidth(limpar(formatBRL(economia)))
    fonte(9)
    cor(CINZA)
    doc.text(limpar(`por mês · ${formatBRL(economia * 12)} por ano`), MX + lEco + 3, y + 6)
    y += 10
    y += await imagem(graficoPlano(a, tema), alturaGraficoPlano)
    y += 3
  }
  a.planoDeAcao.forEach((acao, i) => {
    fonte(8)
    const h = 6.5 + (doc.splitTextToSize(limpar(acao.porque), W - 30) as string[]).length * 3.8
    garantir(h + 2)
    preencher([238, 242, 255])
    doc.roundedRect(MX, y, 6, 6, 1.2, 1.2, 'F')
    fonte(8, 'bold')
    cor(VIOLETA)
    doc.text(String(i + 1), MX + 3, y + 4.2, { align: 'center' })
    fonte(9, 'bold')
    cor(TINTA)
    doc.text(limpar(acao.acao), MX + 9, y + 3.6)
    fonte(7.5)
    cor(CINZA)
    doc.text(limpar(acao.prazo), MX + W, y + 3.6, { align: 'right' })
    paragrafo(acao.porque, MX + 9, y + 4.6, W - 30, 8, 'normal', CINZA)
    y += h + 2
  })
  y += 3

  // ── Gatilhos · Riscos · Pontos fortes (3 colunas) ──
  const colunas: Array<[string, RGB, Array<{ titulo: string; descricao: string }>]> = [
    ['Gatilhos', AMBAR, a.gatilhos],
    ['Riscos', VERMELHO, a.riscos],
    ['Pontos fortes', VERDE, a.pontosFortes],
  ]
  const l3 = (W - 8) / 3
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

  // ── Metas ──
  if (a.metas.length > 0) {
    titulo('Metas', 22)
    const lm = (W - 4 * (a.metas.length - 1)) / a.metas.length
    a.metas.forEach((meta, i) => {
      const x = MX + i * (lm + 4)
      preencher(FUNDO)
      doc.roundedRect(x, y, lm, 20, 2.5, 2.5, 'F')
      fonte(11, 'bold')
      cor(AZUL)
      doc.text(limpar(meta.alvo), x + 3, y + 6.5, { maxWidth: lm - 6 })
      paragrafo(meta.meta, x + 3, y + 9, lm - 6, 7.5, 'bold')
      fonte(6.5)
      cor(CINZA)
      doc.text(limpar(meta.prazo), x + 3, y + 18.5)
    })
    y += 25
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
