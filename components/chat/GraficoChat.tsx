'use client'

import { useMemo, useState } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js'
import type { ChartOptions, TooltipItem } from 'chart.js'
import { Table2, BarChart3 } from 'lucide-react'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'
import { CHART_ANIMATION, tooltipCfg, legendCfg, axisColors } from '@/lib/chartTheme'
import { formatarValorGrafico, type EspecGrafico } from '@/lib/graficoChat'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend)

/**
 * Paleta categórica em ordem fixa (nunca ciclada), com passos próprios para o
 * tema escuro. A série N tem sempre a mesma cor, qualquer que seja o gráfico.
 */
const SERIES_CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
const SERIES_ESCURO = ['#3987e5', '#d95926', '#199e70', '#c98500']
/** Rosca tem até 8 fatias: as 4 cores das séries + 4 que não colidem com elas. */
const FATIAS_CLARO = [...SERIES_CLARO, '#8b5cf6', '#e0457b', '#0ea5b7', '#94a3b8']
const FATIAS_ESCURO = [...SERIES_ESCURO, '#9d7bf7', '#e2628f', '#22b8cc', '#7c8798']

/** Eixo em valor curto ("R$ 1,2 mil") — o tooltip mostra o valor completo. */
function eixoCurto(v: number, unidade: EspecGrafico['unidade']): string {
  if (unidade === 'pct') return `${v}%`
  const abs = Math.abs(v)
  const prefixo = unidade === 'brl' ? 'R$ ' : ''
  if (abs >= 1_000_000) return `${prefixo}${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `${prefixo}${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return `${prefixo}${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

/**
 * Composição de um total: rosca com o total no centro e, embaixo, a legenda
 * com valor e fatia de cada parte — no celular a legenda lateral não cabe.
 */
function Rosca({ grafico, isDark }: { grafico: EspecGrafico; isDark: boolean }) {
  const { rotulos, series, unidade, titulo } = grafico
  const valores = series[0].valores
  const total = valores.reduce((a, v) => a + v, 0)
  const cores = isDark ? FATIAS_ESCURO : FATIAS_CLARO
  const superficie = isDark ? '#1f2937' : '#ffffff'
  // Maior fatia primeiro: a leitura começa pelo que mais pesa.
  // "Outros" fica sempre por último, qualquer que seja o tamanho.
  const ehOutros = (i: number) => /^outros?$/i.test(rotulos[i].trim())
  const ordem = rotulos.map((_, i) => i)
    .sort((a, b) => Number(ehOutros(a)) - Number(ehOutros(b)) || valores[b] - valores[a])

  const data = {
    labels: ordem.map(i => rotulos[i]),
    datasets: [{
      data: ordem.map(i => valores[i]),
      backgroundColor: ordem.map((_, k) => cores[k]),
      borderColor: superficie,
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }
  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    animation: { animateRotate: true, duration: 700 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipCfg(isDark),
        callbacks: {
          label: (item: TooltipItem<'doughnut'>) => {
            const v = Number(item.raw)
            const pct = total > 0 ? (v / total) * 100 : 0
            return `${formatarValorGrafico(v, unidade)} · ${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
          },
        },
      },
    },
  }

  return (
    <div>
      <div className="relative mx-auto" style={{ height: 160, width: 160 }} role="img" aria-label={titulo || 'Gráfico'}>
        <Doughnut data={data} options={options} />
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-gray-500 dark:text-gray-400">Total</span>
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100 num">{eixoCurto(Math.round(total), unidade)}</span>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {ordem.map((i, k) => {
          const pct = total > 0 ? (valores[i] / total) * 100 : 0
          return (
            <li key={rotulos[i] + i} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cores[k] }} />
              <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">{rotulos[i]}</span>
              <span className="num text-gray-800 dark:text-gray-100 font-medium whitespace-nowrap">{formatarValorGrafico(valores[i], unidade)}</span>
              <span className="num w-11 text-right text-gray-400 dark:text-gray-500 whitespace-nowrap">
                {pct.toLocaleString('pt-BR', { maximumFractionDigits: pct < 10 ? 1 : 0 })}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function GraficoChat({ grafico }: { grafico: EspecGrafico }) {
  const { isDark, isDarkRef } = useIsDark()
  const [verTabela, setVerTabela] = useState(false)
  const crosshair = useMemo(() => makeCrosshairPlugin('crosshairChat', isDarkRef), [isDarkRef])

  const { tipo, titulo, rotulos, series, unidade } = grafico
  const horizontal = tipo === 'barra_horizontal'
  const cores = isDark ? SERIES_ESCURO : SERIES_CLARO
  const { txt, grid } = axisColors(isDark)
  const superficie = isDark ? '#1f2937' : '#ffffff'
  const varias = series.length > 1

  const data = {
    labels: rotulos,
    datasets: series.map((s, i) => tipo === 'linha'
      ? {
          label: s.nome,
          data: s.valores,
          borderColor: cores[i],
          backgroundColor: cores[i],
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          // Anel da cor da superfície: pontos sobrepostos continuam distinguíveis.
          pointBorderColor: superficie,
          pointBorderWidth: 2,
          tension: 0.25,
        }
      : {
          label: s.nome,
          data: s.valores,
          backgroundColor: cores[i],
          borderRadius: 4,
          borderSkipped: 'start' as const,
          // Espaço da cor da superfície entre barras vizinhas.
          borderColor: superficie,
          borderWidth: varias ? { top: 0, bottom: 0, left: 1, right: 1 } : 0,
          maxBarThickness: 28,
        }),
  }

  const eixoValor = {
    grid: { color: grid, drawTicks: false },
    border: { display: false },
    ticks: { color: txt, font: { size: 10 }, padding: 6, maxTicksLimit: 5, callback: (v: number | string) => eixoCurto(Number(v), unidade) },
    beginAtZero: true,
  }
  const eixoCategoria = {
    grid: { display: false },
    border: { display: false },
    ticks: { color: txt, font: { size: 10 }, autoSkip: true, maxRotation: 0 },
  }

  const options: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    indexAxis: horizontal ? 'y' : 'x',
    interaction: tipo === 'linha' ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: true },
    plugins: {
      // Uma série só: o título já diz o que é, a legenda seria ruído.
      legend: varias ? legendCfg(isDark) : { display: false },
      tooltip: {
        ...tooltipCfg(isDark),
        callbacks: {
          label: (item: TooltipItem<'bar' | 'line'>) =>
            `${varias ? `${item.dataset.label}: ` : ''}${formatarValorGrafico(Number(item.raw), unidade)}`,
        },
      },
    },
    scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
  }

  const altura = horizontal ? Math.max(140, rotulos.length * (varias ? 34 : 26) + 40) : 200

  return (
    <figure className="my-3 -mx-1 rounded-2xl border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 p-3">
      <figcaption className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 tracking-tight">{titulo}</span>
        <button
          type="button"
          onClick={() => setVerTabela(v => !v)}
          aria-label={verTabela ? 'Ver como gráfico' : 'Ver como tabela'}
          className="shrink-0 inline-flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 rounded-lg px-1.5 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {verTabela ? <BarChart3 className="w-3 h-3" /> : <Table2 className="w-3 h-3" />}
          {verTabela ? 'Gráfico' : 'Tabela'}
        </button>
      </figcaption>

      {verTabela ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400">
                <th className="text-left font-medium py-1 pr-3" />
                {series.map(s => <th key={s.nome} className="text-right font-medium py-1 pl-3">{s.nome}</th>)}
              </tr>
            </thead>
            <tbody>
              {rotulos.map((r, i) => (
                <tr key={r + i} className="border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300">
                  <td className="py-1.5 pr-3">{r}</td>
                  {series.map(s => (
                    <td key={s.nome} className="py-1.5 pl-3 text-right num whitespace-nowrap">{formatarValorGrafico(s.valores[i], unidade)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tipo === 'rosca' ? (
        <Rosca grafico={grafico} isDark={isDark} />
      ) : (
        <div style={{ height: altura }} role="img" aria-label={titulo || 'Gráfico'}>
          {tipo === 'linha'
            ? <Line data={data as never} options={options as ChartOptions<'line'>} plugins={[crosshair]} />
            : <Bar data={data as never} options={options as ChartOptions<'bar'>} />}
        </div>
      )}
    </figure>
  )
}
