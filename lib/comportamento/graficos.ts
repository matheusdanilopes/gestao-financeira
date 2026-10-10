/**
 * Gráficos da Análise de Comportamento — configurações Chart.js puras.
 *
 * As mesmas funções servem à tela (react-chartjs-2) e ao PDF (renderizadas
 * num canvas fora da tela e coladas como imagem): o gráfico impresso é o
 * mesmo que a pessoa viu.
 *
 * Cores: paleta categórica validada do app (a mesma do gráfico do chat), em
 * ordem fixa; comparação "agora × normal" usa a série 1 contra um cinza de
 * referência; saldo usa o par divergente azul ↔ vermelho.
 */

import type { ChartConfiguration, Plugin } from 'chart.js'
import { rotuloMesIso } from './documento'
import type { AnaliseIA, MetricasComportamento } from './tipos'

export interface TemaGrafico {
  escuro: boolean
  /** Rótulos de valor sobre as barras — para o PDF, onde não há tooltip. */
  rotulos?: boolean
}

function cores(escuro: boolean) {
  return {
    serie1: escuro ? '#3987e5' : '#2a78d6',
    serie2: escuro ? '#d95926' : '#eb6834',
    referencia: escuro ? '#5b5a55' : '#c3c2b7',
    negativo: escuro ? '#e66767' : '#e34948',
    texto: escuro ? '#c3c2b7' : '#52514e',
    eixo: escuro ? '#898781' : '#898781',
    grade: escuro ? 'rgba(255,255,255,0.06)' : '#ecebe6',
  }
}

/** "R$ 12,3 mil" — para eixos e rótulos; o tooltip mostra o valor completo. */
export function brlCurto(v: number): string {
  const abs = Math.abs(v)
  const sinal = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `${sinal}R$ ${(abs / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return `${sinal}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Escreve o valor na ponta de cada barra (só quando `tema.rotulos`). */
function pluginRotulos(tema: TemaGrafico): Plugin {
  return {
    id: 'rotulosComportamento',
    afterDatasetsDraw(chart) {
      if (!tema.rotulos) return
      const { ctx } = chart
      const horizontal = chart.options.indexAxis === 'y'
      ctx.save()
      ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif'
      ctx.fillStyle = cores(tema.escuro).texto
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i)
        if (meta.hidden) return
        meta.data.forEach((el, j) => {
          const v = Number(ds.data[j] ?? 0)
          if (!v) return
          const { x, y } = el.getProps(['x', 'y'], true) as { x: number; y: number }
          const txt = brlCurto(v)
          if (horizontal) {
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(txt, x + 4, y)
          } else {
            ctx.textAlign = 'center'
            ctx.textBaseline = v < 0 ? 'top' : 'bottom'
            ctx.fillText(txt, x, v < 0 ? y + 3 : y - 3)
          }
        })
      })
      ctx.restore()
    },
  }
}

function base(tema: TemaGrafico, horizontal = false, legenda = true) {
  const c = cores(tema.escuro)
  const eixoValor = {
    grid: { color: c.grade },
    border: { display: false },
    ticks: { color: c.eixo, font: { size: 10 }, callback: (v: string | number) => brlCurto(Number(v)), maxTicksLimit: 5 },
  }
  const eixoCategoria = {
    grid: { display: false },
    border: { color: c.referencia },
    ticks: { color: c.eixo, font: { size: 10 }, autoSkip: false },
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: tema.rotulos ? (false as const) : { duration: 450 },
    indexAxis: horizontal ? ('y' as const) : ('x' as const),
    layout: { padding: { top: tema.rotulos ? 16 : 4, right: horizontal && tema.rotulos ? 56 : 8 } },
    plugins: {
      legend: legenda
        ? { position: 'bottom' as const, labels: { color: c.texto, font: { size: 11 }, boxWidth: 10, boxHeight: 10, padding: 14 } }
        : { display: false },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.96)',
        padding: 10,
        cornerRadius: 10,
        callbacks: {
          label: (item: { dataset: { label?: string }; raw: unknown }) =>
            `${item.dataset.label ? `${item.dataset.label}: ` : ''}${brl(Number(item.raw))}`,
        },
      },
    },
    scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
  }
}

const barra = { borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 28, categoryPercentage: 0.72, barPercentage: 0.9 }

/** Rótulo do mês com o foco destacado. */
function rotulosMeses(m: MetricasComportamento) {
  return m.mensal.filter(x => !x.parcial).map(x => rotuloMesIso(x.mes).replace(/\/\d{2}(\d{2})$/, '/$1'))
}

/** Receita × gasto, mês a mês (meses fechados). */
export function graficoReceitaGasto(m: MetricasComportamento, tema: TemaGrafico): ChartConfiguration<'bar'> {
  const c = cores(tema.escuro)
  const meses = m.mensal.filter(x => !x.parcial)
  return {
    type: 'bar',
    data: {
      labels: rotulosMeses(m),
      datasets: [
        { label: 'Receita', data: meses.map(x => x.receita), backgroundColor: c.serie1, ...barra },
        { label: 'Gasto', data: meses.map(x => x.gastoTotal), backgroundColor: c.serie2, ...barra },
      ],
    },
    options: base(tema),
    plugins: [pluginRotulos({ ...tema, rotulos: false })],
  }
}

/** Saldo do mês (receita − gasto): azul quando sobra, vermelho quando falta. */
export function graficoSaldo(m: MetricasComportamento, tema: TemaGrafico): ChartConfiguration<'bar'> {
  const c = cores(tema.escuro)
  const meses = m.mensal.filter(x => !x.parcial && x.receita > 0)
  const opcoes = base(tema, false, false)
  return {
    type: 'bar',
    data: {
      labels: meses.map(x => rotuloMesIso(x.mes).replace(/\/\d{2}(\d{2})$/, '/$1')),
      datasets: [{
        label: 'Saldo',
        data: meses.map(x => x.saldo),
        backgroundColor: meses.map(x => (x.saldo >= 0 ? c.serie1 : c.negativo)),
        ...barra,
        borderSkipped: false,
      }],
    },
    options: {
      ...opcoes,
      plugins: {
        ...opcoes.plugins,
        tooltip: {
          ...opcoes.plugins.tooltip,
          callbacks: {
            label: (item: { dataIndex: number; raw: unknown }) => {
              const mes = meses[item.dataIndex]
              const taxa = mes.taxaPoupanca === null ? '' : ` (${mes.taxaPoupanca.toLocaleString('pt-BR')}% da receita)`
              return `Saldo: ${brl(Number(item.raw))}${taxa}`
            },
          },
        },
      },
    },
    plugins: [pluginRotulos(tema)],
  }
}

/** Categorias: agora × normal (mês em foco ou últimos 3 meses × anteriores). */
export function graficoCategorias(m: MetricasComportamento, tema: TemaGrafico): ChartConfiguration<'bar'> | null {
  const c = cores(tema.escuro)
  const linhas = m.mesFoco
    ? m.mesFoco.categorias.map(x => ({ nome: x.categoria, agora: x.atual, normal: x.base }))
    : m.categorias.map(x => ({ nome: x.categoria, agora: x.mediaRecente, normal: x.mediaAnterior }))
  const top = linhas.filter(l => l.agora > 0 || l.normal > 0).slice(0, 8)
  if (top.length === 0) return null
  const [rotuloAgora, rotuloNormal] = m.mesFoco
    ? [rotuloMesIso(m.mesFoco.mes), 'Média dos meses anteriores']
    : ['Média dos últimos 3 meses', 'Média dos meses anteriores']
  return {
    type: 'bar',
    data: {
      labels: top.map(l => (l.nome.length > 16 ? `${l.nome.slice(0, 15)}…` : l.nome)),
      datasets: [
        { label: rotuloAgora, data: top.map(l => l.agora), backgroundColor: c.serie1, ...barra, maxBarThickness: 12 },
        { label: rotuloNormal, data: top.map(l => l.normal), backgroundColor: c.referencia, ...barra, maxBarThickness: 12 },
      ],
    },
    options: base(tema, true),
    plugins: [pluginRotulos(tema)],
  }
}

/** Economia mensal estimada por ação do plano. */
export function graficoPlano(a: AnaliseIA, tema: TemaGrafico): ChartConfiguration<'bar'> | null {
  const c = cores(tema.escuro)
  // Rótulo = número da ação na lista ao lado: o texto inteiro não cabe no eixo.
  const acoes = a.planoDeAcao.map((p, i) => ({ ...p, n: i + 1 })).filter(p => p.economiaMensal > 0)
  if (acoes.length === 0) return null
  return {
    type: 'bar',
    data: {
      labels: acoes.map(p => `Ação ${p.n}`),
      datasets: [{ label: 'Economia por mês', data: acoes.map(p => p.economiaMensal), backgroundColor: c.serie1, ...barra, maxBarThickness: 16 }],
    },
    options: base(tema, true, false),
    plugins: [pluginRotulos(tema)],
  }
}

/** Escala sequencial de um tom (azul), do quase-zero ao máximo — para o mapa de calor. */
export const RAMPA_AZUL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']

export function corDaRampa(valor: number, maximo: number): string | null {
  if (valor <= 0 || maximo <= 0) return null
  const idx = Math.min(RAMPA_AZUL.length - 1, Math.floor((valor / maximo) * (RAMPA_AZUL.length - 1) + 0.0001))
  return RAMPA_AZUL[idx]
}
