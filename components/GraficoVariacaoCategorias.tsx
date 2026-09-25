'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import type { TooltipItem } from 'chart.js'
import { addMonths, differenceInCalendarDays, format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertCircle, Scale } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { supabase } from '@/lib/supabaseClient'
import { useIsDark } from '@/lib/useIsDark'
import { CHART_ANIMATION, tooltipCfg, axisColors } from '@/lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

/** Quantas faturas anteriores compõem a média de referência */
const MESES_BASE = 3
/** Quantas categorias (maiores variações em R$) são exibidas */
const MAX_CATS = 8
/** Duração nominal do ciclo de fatura, usada só para prorratear a média */
const DIAS_CICLO = 30

const ALTA = { r: 239, g: 68,  b: 68  } // red-500
const BAIXA = { r: 16, g: 185, b: 129 } // emerald-500

function rgba(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

interface TransacaoRaw {
  valor: number
  categoria: string | null
  projeto_fatura: string
}

interface VariacaoCategoria {
  categoria: string
  atual: number
  /** Média das faturas anteriores já ajustada à fração do ciclo decorrida */
  referencia: number
  delta: number
  /** null quando não havia gasto na categoria antes (categoria nova) */
  pct: number | null
}

interface Dados {
  variacoes: VariacaoCategoria[]
  totalAtual: number
  totalReferencia: number
  /** Faturas anteriores que realmente tinham lançamentos (ex.: ['Ago', 'Set']) */
  mesesBase: string[]
  /** 1 = ciclo fechado; < 1 = fatura em aberto, média prorrateada */
  fracaoCiclo: number
}

interface Props {
  mesAtual: Date
  /** Fechamento da fatura do mês (yyyy-MM-dd) — usado para prorratear a média
   *  enquanto a fatura ainda está em aberto. */
  dataFechamentoFatura?: string | null
  /** false pausa o fetch sem desmontar o componente (ex.: aba oculta). */
  ativo?: boolean
}

export default function GraficoVariacaoCategorias({
  mesAtual,
  dataFechamentoFatura,
  ativo = true,
}: Props) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const { isDark } = useIsDark()
  const cache = useRef(new Map<string, Dados>())
  // Descarta resposta de requisição antiga (troca rápida de mês)
  const reqId = useRef(0)

  // Fatura correspondente ao mês do dashboard (compras do mês M caem na fatura M+1)
  const mesRefFatura = useMemo(
    () => format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd'),
    [mesAtual],
  )

  const mesesAnteriores = useMemo(
    () => Array.from({ length: MESES_BASE }, (_, i) =>
      format(startOfMonth(subMonths(new Date(mesRefFatura + 'T12:00:00'), i + 1)), 'yyyy-MM-dd'),
    ),
    [mesRefFatura],
  )

  // Fração do ciclo já decorrida: compara o parcial da fatura aberta com a mesma
  // fatia da média histórica, senão todo mês começaria "muito abaixo da média".
  // `iniciado` é false para uma fatura futura, em que comparar não faz sentido.
  const { fracaoCiclo, cicloIniciado } = useMemo(() => {
    if (!dataFechamentoFatura) return { fracaoCiclo: 1, cicloIniciado: true }
    const fechamento = new Date(dataFechamentoFatura + 'T12:00:00')
    const faltam = differenceInCalendarDays(fechamento, new Date())
    if (faltam <= 0) return { fracaoCiclo: 1, cicloIniciado: true }
    if (faltam >= DIAS_CICLO) return { fracaoCiclo: 1, cicloIniciado: false }
    return { fracaoCiclo: (DIAS_CICLO - faltam) / DIAS_CICLO, cicloIniciado: true }
  }, [dataFechamentoFatura])

  const carregar = useCallback(async () => {
    const id = ++reqId.current
    const chaveCache = `${mesRefFatura}:${fracaoCiclo.toFixed(2)}`
    const cached = cache.current.get(chaveCache)
    if (cached) setDados(cached)
    else setCarregando(true)
    setErro(null)

    try {
      const { data, error } = await supabase
        .from('transacoes_nubank')
        .select('valor, categoria, projeto_fatura')
        .in('projeto_fatura', [mesRefFatura, ...mesesAnteriores])
        .neq('status', 'ESTORNO')
        .neq('status', 'ESTORNADO')

      if (error) throw error
      if (id !== reqId.current) return

      const linhas = (data ?? []) as TransacaoRaw[]

      const porMes = new Map<string, Map<string, number>>()
      for (const t of linhas) {
        const cat = t.categoria || 'Sem categoria'
        const mes = porMes.get(t.projeto_fatura) ?? new Map<string, number>()
        mes.set(cat, (mes.get(cat) ?? 0) + Number(t.valor ?? 0))
        porMes.set(t.projeto_fatura, mes)
      }

      const atual = porMes.get(mesRefFatura) ?? new Map<string, number>()
      const basesComDados = mesesAnteriores.filter(m => (porMes.get(m)?.size ?? 0) > 0)

      const categorias = new Set<string>([
        ...atual.keys(),
        ...basesComDados.flatMap(m => [...(porMes.get(m)?.keys() ?? [])]),
      ])

      const variacoes: VariacaoCategoria[] = [...categorias].map(cat => {
        const valorAtual = atual.get(cat) ?? 0
        const somaBase = basesComDados.reduce((s, m) => s + (porMes.get(m)?.get(cat) ?? 0), 0)
        const media = basesComDados.length > 0 ? somaBase / basesComDados.length : 0
        const referencia = media * fracaoCiclo
        return {
          categoria: cat,
          atual: valorAtual,
          referencia,
          delta: valorAtual - referencia,
          pct: referencia > 0 ? ((valorAtual - referencia) / referencia) * 100 : null,
        }
      })

      const relevantes = variacoes
        .filter(v => Math.abs(v.delta) >= 1)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, MAX_CATS)

      const entry: Dados = {
        variacoes: relevantes,
        totalAtual: [...atual.values()].reduce((s, v) => s + v, 0),
        totalReferencia: variacoes.reduce((s, v) => s + v.referencia, 0),
        mesesBase: basesComDados
          .map(m => format(new Date(m + 'T12:00:00'), 'MMM', { locale: ptBR }))
          .reverse(),
        fracaoCiclo,
      }

      cache.current.set(chaveCache, entry)
      if (cache.current.size > 12) {
        const oldest = cache.current.keys().next().value
        if (oldest) cache.current.delete(oldest)
      }
      setDados(entry)
    } catch {
      if (id === reqId.current) setErro('Não foi possível comparar as faturas.')
    } finally {
      if (id === reqId.current) setCarregando(false)
    }
  }, [mesRefFatura, mesesAnteriores, fracaoCiclo])

  useEffect(() => {
    if (!ativo || !cicloIniciado) return
    carregar()
  }, [carregar, ativo, cicloIniciado])

  const chartData = useMemo(() => {
    if (!dados?.variacoes.length) return null
    return {
      labels: dados.variacoes.map(v =>
        v.categoria.length > 14 ? v.categoria.slice(0, 13) + '…' : v.categoria,
      ),
      datasets: [
        {
          label: 'Variação',
          data: dados.variacoes.map(v => v.delta),
          backgroundColor: dados.variacoes.map(v =>
            rgba(v.delta > 0 ? ALTA : BAIXA, isDark ? 0.8 : 0.75),
          ),
          hoverBackgroundColor: dados.variacoes.map(v => rgba(v.delta > 0 ? ALTA : BAIXA, 1)),
          borderRadius: 6,
          borderSkipped: false as const,
          maxBarThickness: 22,
        },
      ],
    }
  }, [dados, isDark])

  const options = useMemo(() => {
    const { txt, grid } = axisColors(isDark)
    return {
      indexAxis: 'y' as const,
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIMATION,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipCfg(isDark),
          displayColors: false,
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) =>
              dados?.variacoes[items[0]?.dataIndex ?? 0]?.categoria ?? '',
            label: (ctx: TooltipItem<'bar'>) => {
              const v = dados?.variacoes[ctx.dataIndex]
              if (!v) return ''
              const sinal = v.delta >= 0 ? '+' : '−'
              const linhas = [
                `  Nesta fatura: ${formatBRL(v.atual)}`,
                `  Referência: ${formatBRL(v.referencia)}`,
                `  Diferença: ${sinal}${formatBRL(Math.abs(v.delta))}`,
              ]
              linhas.push(
                v.pct === null
                  ? '  Categoria nova no período'
                  : `  Variação: ${v.pct >= 0 ? '+' : ''}${v.pct.toFixed(0)}%`,
              )
              return linhas
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: grid, lineWidth: 1 },
          border: { display: false },
          ticks: {
            callback: (v: number | string) => {
              const n = Number(v)
              if (n === 0) return '0'
              const abs = Math.abs(n)
              const txtValor = abs >= 1000 ? `R$${(abs / 1000).toFixed(1).replace('.', ',')}k` : `R$${abs.toFixed(0)}`
              return n < 0 ? `-${txtValor}` : `+${txtValor}`
            },
            font: { size: 10 },
            color: txt,
            maxTicksLimit: 5,
          },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 11 }, color: txt, padding: 4 },
        },
      },
    }
  }, [isDark, dados])

  if (!cicloIniciado) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-center px-4">
        <Scale className="w-8 h-8 opacity-30" />
        <span className="text-sm">Este ciclo de fatura ainda não começou</span>
        <span className="text-xs">A comparação aparece quando as primeiras compras entrarem</span>
      </div>
    )
  }

  if (carregando && !dados) {
    return (
      <div className="h-64 animate-pulse flex flex-col justify-center gap-3 px-2">
        {[70, 55, 82, 40, 62, 34].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2.5 w-16 rounded-full bg-gray-100 dark:bg-white/[0.05]" />
            <div
              className="h-4 rounded-md bg-gray-100 dark:bg-white/[0.05]"
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
    )
  }

  if (erro) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-7 h-7 opacity-70" />
        <span className="text-sm text-gray-500">{erro}</span>
        <button
          onClick={() => { setCarregando(true); carregar() }}
          className="text-xs text-primary-500 hover:text-primary-600 underline transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!dados || dados.mesesBase.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-center px-4">
        <Scale className="w-8 h-8 opacity-30" />
        <span className="text-sm">Sem faturas anteriores para comparar</span>
        <span className="text-xs">É preciso ao menos mais uma fatura importada</span>
      </div>
    )
  }

  if (!chartData) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-center px-4">
        <Scale className="w-8 h-8 opacity-30" />
        <span className="text-sm">Gastos em linha com os meses anteriores</span>
        <span className="text-xs">Nenhuma categoria fugiu da média</span>
      </div>
    )
  }

  const deltaTotal = dados.totalAtual - dados.totalReferencia
  const pctTotal = dados.totalReferencia > 0 ? (deltaTotal / dados.totalReferencia) * 100 : null
  const alturaGrafico = Math.max(dados.variacoes.length * 34 + 28, 160)

  return (
    <div>
      {/* Resumo do período */}
      <div className="flex items-end justify-between mb-4 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
            Total da fatura
          </p>
          <p className="text-xl font-bold text-gray-700 num leading-none">
            {formatBRL(dados.totalAtual)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
            vs. referência
          </p>
          <p
            className={`text-sm font-bold num leading-none ${
              deltaTotal > 0 ? 'text-red-500' : 'text-emerald-600'
            }`}
          >
            {deltaTotal >= 0 ? '+' : '−'}{formatBRL(Math.abs(deltaTotal))}
            {pctTotal !== null && (
              <span className="font-semibold text-[11px] ml-1">
                ({pctTotal >= 0 ? '+' : ''}{pctTotal.toFixed(0)}%)
              </span>
            )}
          </p>
        </div>
      </div>

      <div style={{ height: alturaGrafico }}>
        <Bar data={chartData} options={options} />
      </div>

      <p className="text-[11px] text-gray-400 mt-3 leading-snug">
        Referência: média das últimas {dados.mesesBase.length}{' '}
        {dados.mesesBase.length === 1 ? 'fatura' : 'faturas'} ({dados.mesesBase.join(' · ')})
        {dados.fracaoCiclo < 1 && (
          <> · ajustada aos {Math.round(dados.fracaoCiclo * 100)}% do ciclo já decorridos</>
        )}
      </p>
    </div>
  )
}
