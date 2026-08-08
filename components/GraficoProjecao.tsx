'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { addMonths, format, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { MousePointerClick, AlertCircle } from 'lucide-react'
import { formatBRL } from '@/lib/logger'
import type { TooltipItem, ActiveElement, ChartEvent, Plugin } from 'chart.js'
import { useIsDark } from '@/lib/useIsDark'
import { makeCrosshairPlugin } from '@/lib/chartPlugins'
import { CHART_ANIMATION, tooltipCfg, legendCfg, axisColors } from '@/lib/chartTheme'

interface GradientChart {
  ctx: CanvasRenderingContext2D
  chartArea?: { top: number; bottom: number }
  data: { datasets: Array<{ backgroundColor?: string | CanvasGradient | null }> }
}

const PROJECAO_OFFSET_MESES = 1
const POLL_DELAY = 40_000 // ms — escalonado para não coincidir com os outros dois gráficos
// Janela máxima pedida à API (mesmo teto aceito por /api/projection) — o gráfico é
// então cortado no último mês que ainda tem parcela (ver trimAoUltimoMesComParcela),
// então isto é só o limite superior de meses possivelmente exibidos, não o padrão.
const MESES_MAXIMOS = 24

// Descarta os meses finais da janela pedida em que nenhuma série (Total, Matheus,
// Jeniffer, Despesas) tem valor — o gráfico deve ir só até o último mês com parcela
// em aberto, não até o teto fixo pedido à API. Mantém ao menos 1 mês.
function trimAoUltimoMesComParcela(d: DadosProjecao): DadosProjecao {
  let ultimoIndice = -1
  for (let i = 0; i < d.total.length; i++) {
    if (d.total[i] !== 0 || d.matheus[i] !== 0 || d.jeniffer[i] !== 0 || d.extra[i] !== 0) ultimoIndice = i
  }
  const corte = ultimoIndice === -1 ? 1 : ultimoIndice + 1
  return {
    labels: d.labels.slice(0, corte),
    datas: d.datas.slice(0, corte),
    total: d.total.slice(0, corte),
    matheus: d.matheus.slice(0, corte),
    jeniffer: d.jeniffer.slice(0, corte),
    extra: d.extra.slice(0, corte),
  }
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const C = {
  violet: { r: 124, g: 58,  b: 237 }, // violet-600 — Total
  blue:   { r: 59,  g: 130, b: 246 }, // blue-500   — Matheus
  pink:   { r: 236, g: 72,  b: 153 }, // pink-500   — Jeniffer
  amber:  { r: 245, g: 158, b: 11  }, // amber-500  — Despesas extras
} as const

function rgba(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface DadosProjecao {
  labels: string[]
  datas:  string[]
  total:    number[]
  matheus:  number[]
  jeniffer: number[]
  extra:    number[]
}

interface Props {
  mesInicio?: Date
  onPontoClicado: (serie: string, mes: string, valor: number, itens: Record<string, unknown>[]) => void
  /** Controla o polling de 60s — false pausa fetch/timers sem desmontar o gráfico (ex: aba oculta). Default: true. */
  ativo?: boolean
}

// Gradient fill only for Total dataset
const gradientPlugin = {
  id: 'gradientFillProj',
  beforeDatasetsDraw(chart: GradientChart) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const ds = chart.data.datasets[0]
    if (!ds) return
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
    g.addColorStop(0,    rgba(C.violet, 0.22))
    g.addColorStop(0.55, rgba(C.violet, 0.06))
    g.addColorStop(1,    rgba(C.violet, 0))
    ds.backgroundColor = g
  },
}

export default function GraficoProjecao({ mesInicio, onPontoClicado, ativo = true }: Props) {
  const [dados, setDados] = useState<DadosProjecao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark, isDarkRef } = useIsDark()
  const dataCache = useRef(new Map<string, DadosProjecao>())

  // Refs so the onClick closure never goes stale
  const dadosRef = useRef<DadosProjecao | null>(null)
  const onClickRef = useRef(onPontoClicado)
  useEffect(() => { onClickRef.current = onPontoClicado }, [onPontoClicado])

  // Exige 2 cliques no mesmo mês antes de abrir o detalhamento — evita
  // abertura acidental ao só explorar o gráfico (o tooltip já responde ao 1º toque)
  const pendingIndexRef = useRef<number | null>(null)
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current)
  }, [])

  // Plugin criado uma única vez — lê isDarkRef.current no draw, sem recriar objeto
  // Preserva as opacidades originais deste gráfico (0.13 / 0.09)
  const plugins = useMemo(
    () => [gradientPlugin, makeCrosshairPlugin('crosshairProj', isDarkRef, 0.13, 0.09)] as Plugin<'line'>[],
    [isDarkRef],
  )

  const carregar = useCallback(async () => {
    const mesKey = format(mesInicio ? startOfMonth(mesInicio) : new Date(), 'yyyy-MM')
    const cached = dataCache.current.get(mesKey)
    if (cached) {
      setDados(cached)
      dadosRef.current = cached
    } else {
      setCarregando(true)
    }
    setErro(null)
    try {
      const base  = mesInicio ? startOfMonth(mesInicio) : new Date()
      const inicio = startOfMonth(addMonths(base, PROJECAO_OFFSET_MESES))

      const labels: string[] = []
      const datas:  string[] = []
      for (let i = 0; i < MESES_MAXIMOS; i++) {
        const m = addMonths(inicio, i)
        labels.push(format(m, 'MMM/yy', { locale: ptBR }))
        datas.push(format(startOfMonth(m), 'yyyy-MM-dd'))
      }

      const res = await fetch('/api/projection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meses: labels, inicioStr: datas[0] }),
      })
      if (!res.ok) throw new Error('Falha ao carregar projeção')
      const { total, matheus, jeniffer, extra } = await res.json()

      const d: DadosProjecao = trimAoUltimoMesComParcela({ labels, datas, total, matheus, jeniffer, extra })
      dataCache.current.set(mesKey, d)
      if (dataCache.current.size > 12) {
        const oldest = dataCache.current.keys().next().value
        if (oldest) dataCache.current.delete(oldest)
      }
      setDados(d)
      dadosRef.current = d
    } catch {
      setErro('Não foi possível carregar a projeção.')
    } finally {
      setCarregando(false)
    }
  }, [mesInicio])

  // Pausa fetch + polling quando o gráfico está fora de vista (ex: aba "Gráficos"
  // fechada no Dashboard) — o componente continua montado (cache preservado),
  // só evita trabalho de rede/CPU sem benefício visual enquanto oculto.
  useEffect(() => {
    if (!ativo) return
    carregar()
    let intervalId: ReturnType<typeof setInterval>
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(carregar, 60_000)
    }, POLL_DELAY)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [carregar, ativo])

  const chartData = useMemo(() => {
    if (!dados) return null
    const pBorder = isDark ? '#0f172a' : '#ffffff'

    const mkSecondary = (
      label: string,
      data: number[],
      color: { r: number; g: number; b: number },
      dash?: number[],
    ) => ({
      label,
      data,
      borderColor: rgba(color, 0.75),
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      ...(dash ? { borderDash: dash } : {}),
      tension: 0.45,
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHitRadius: 24,
      pointBackgroundColor: rgba(color),
      pointBorderColor: pBorder,
      pointBorderWidth: 1.5,
      pointHoverBorderWidth: 1.5,
    })

    return {
      labels: dados.labels,
      datasets: [
        {
          label: 'Total',
          data: dados.total,
          borderColor: rgba(C.violet),
          backgroundColor: 'transparent', // filled by gradientPlugin
          borderWidth: 2.5,
          tension: 0.45,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 8,
          pointHitRadius: 28,
          pointBackgroundColor: rgba(C.violet),
          pointBorderColor: pBorder,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2,
        },
        mkSecondary('Matheus',  dados.matheus,  C.blue),
        mkSecondary('Jeniffer', dados.jeniffer, C.pink),
        mkSecondary('Despesas', dados.extra,    C.amber, [5, 4]),
      ],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    const { txt, grid } = axisColors(isDark)
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: CHART_ANIMATION,
      plugins: {
        legend: legendCfg(isDark),
        tooltip: {
          ...tooltipCfg(isDark),
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: false,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => items[0]?.label ?? '',
            label: (ctx: TooltipItem<'line'>) => `  ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v: number | string) => formatBRL(Number(v)),
            font: { size: 10 },
            maxTicksLimit: 5,
            color: txt,
          },
          grid: { color: grid, lineWidth: 1 },
          border: { display: false },
        },
        x: {
          ticks: { font: { size: 11 }, color: txt, padding: 8 },
          grid: { display: false },
          border: { display: false },
        },
      },
      onClick: async (_event: ChartEvent, elements: ActiveElement[]) => {
        if (!elements.length) return
        const { datasetIndex, index } = elements[0]

        if (pendingIndexRef.current !== index) {
          // 1º clique neste mês — arma e aguarda confirmação
          pendingIndexRef.current = index
          if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current)
          pendingTimeoutRef.current = setTimeout(() => {
            pendingIndexRef.current = null
          }, 3000)
          return
        }
        // 2º clique no mesmo mês — confirma e abre o detalhamento
        pendingIndexRef.current = null
        if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current)

        const d = dadosRef.current
        if (!d) return
        const labels   = ['Total', 'Matheus', 'Jeniffer', 'Despesas']
        const arrays   = [d.total, d.matheus, d.jeniffer, d.extra]
        const serie    = labels[datasetIndex]
        const mes      = d.labels[index]
        const valor    = arrays[datasetIndex]?.[index] ?? 0
        const mesStr   = d.datas[index]
        try {
          const res = await fetch('/api/projection/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serie, mesStr }),
          })
          const { itens } = await res.json()
          onClickRef.current(serie, mes, valor, itens)
        } catch {
          // ignore detail fetch errors silently
        }
      },
    }
  }, [isDark])

  if (carregando) {
    return (
      <div className="h-56 md:h-64 lg:h-72 animate-pulse flex flex-col justify-between pt-3 pb-2 px-2">
        <div className="flex flex-col justify-between h-[calc(100%-36px)]">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2.5 rounded-full bg-gray-100 dark:bg-white/[0.05]" style={{ width: 38 + i * 5 }} />
              <div className="flex-1 h-px bg-gray-100 dark:bg-white/[0.04]" />
            </div>
          ))}
        </div>
        <div className="flex gap-4 justify-center mt-2 flex-wrap">
          {[
            { w: 'w-10', c: 'bg-violet-200 dark:bg-violet-900/40' },
            { w: 'w-14', c: 'bg-blue-200 dark:bg-blue-900/40' },
            { w: 'w-14', c: 'bg-pink-200 dark:bg-pink-900/40' },
            { w: 'w-16', c: 'bg-amber-200 dark:bg-amber-900/40' },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`h-0.5 w-5 rounded-full ${item.c}`} />
              <div className={`h-2 ${item.w} bg-gray-100 dark:bg-white/[0.05] rounded-full`} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="h-72 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button onClick={carregar} className="text-xs text-primary-500 hover:text-primary-600 underline transition-colors">
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!chartData) return null

  return (
    <div>
      <div className="h-56 md:h-64 lg:h-72">
        <Line data={chartData} options={options} plugins={plugins} />
      </div>
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 mt-3">
        <MousePointerClick className="w-3.5 h-3.5" />
        Toque duas vezes no mês para ver as parcelas
      </p>
    </div>
  )
}
