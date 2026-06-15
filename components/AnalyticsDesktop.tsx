'use client'

import { useState, useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import type { ChartOptions } from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { BarChart3, ChevronUp, ChevronDown, X, ChevronsUpDown } from 'lucide-react'
import { CATEGORIAS_PADRAO } from '@/lib/categorias'
import {
  useAnalyticsData,
  type AnalyticsMensalRow,
  type AnalyticsFilters,
  defaultDateFrom,
  defaultDateTo,
  CAT_COLORS,
} from '@/lib/useAnalyticsData'
import { useIsDark } from '@/lib/useIsDark'
import { CHART_ANIMATION, tooltipCfg } from '@/lib/chartTheme'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// ── Chart option builder (dark-aware) ────────────────────────────────────────

function buildTrendOptions(isDark: boolean): ChartOptions<'line'> {
  const txt  = isDark ? '#6b7280' : '#9ca3af'
  const grid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: CHART_ANIMATION,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipCfg(isDark),
        displayColors: false,
        callbacks: {
          label: (ctx) =>
            `  R$ ${(ctx.parsed.y ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: txt, padding: 6 },
        border: { display: false },
      },
      y: {
        grid: { color: grid, lineWidth: 1 },
        border: { display: false },
        ticks: {
          callback: (v) =>
            Number(v) >= 1000 ? `R$${(Number(v) / 1000).toFixed(0)}k` : `R$${v}`,
          font: { size: 10 },
          color: txt,
          maxTicksLimit: 5,
          padding: 6,
        },
      },
    },
  }
}

function buildDonutOptions(isDark: boolean): ChartOptions<'doughnut'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    animation: { duration: 500, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipCfg(isDark),
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        callbacks: {
          label: (ctx) => {
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0)
            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'
            return `  R$ ${ctx.parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pct}%)`
          },
        },
      },
    },
  }
}

function buildBarOptions(isDark: boolean): ChartOptions<'bar'> {
  const txt  = isDark ? '#6b7280' : '#9ca3af'
  const grid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: CHART_ANIMATION,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
          boxHeight: 6,
          padding: 16,
          color: isDark ? '#6b7280' : '#9ca3af',
        },
      },
      tooltip: {
        ...tooltipCfg(isDark),
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        callbacks: {
          label: (ctx) =>
            `  R$ ${(ctx.parsed.y ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 }, color: txt, padding: 4 }, border: { display: false } },
      y: {
        grid: { color: grid, lineWidth: 1 },
        border: { display: false },
        ticks: {
          callback: (v) =>
            Number(v) >= 1000 ? `R$${(Number(v) / 1000).toFixed(0)}k` : `R$${v}`,
          font: { size: 10 },
          color: txt,
          maxTicksLimit: 5,
          padding: 6,
        },
      },
    },
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = keyof AnalyticsMensalRow
interface SortConfig { key: SortKey; dir: 'asc' | 'desc' }

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-[#1e293b] rounded-2xl shadow-card border border-gray-100 dark:border-white/[0.06] px-4 py-3 flex flex-col gap-0.5 min-w-0 transition-shadow hover:shadow-md">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">{label}</span>
      <span className={`text-xl font-bold leading-tight truncate num ${accent ?? 'text-gray-800 dark:text-gray-100'}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-gray-400 dark:text-gray-500">{sub}</span>}
    </div>
  )
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-[#1e293b] rounded-3xl shadow-card border border-gray-100 dark:border-white/[0.06] p-5 flex flex-col gap-4 transition-shadow hover:shadow-md ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsDesktop() {
  const { isDark } = useIsDark()
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [responsavel, setResponsavel] = useState<AnalyticsFilters['responsavel']>('')
  const [sort, setSort] = useState<SortConfig>({ key: 'mes', dir: 'desc' })
  const [catSearch, setCatSearch] = useState('')

  const filters: AnalyticsFilters = { dateFrom, dateTo, categorias: selectedCats, responsavel }

  const {
    rows,
    loading,
    trendChartData,
    categoryDonutData,
    personBarData,
    kpis,
    cashFlowData,
    budgetProgress,
    plannedVsPaidData,
    remainingByMonthData,
    cardCategoryTreemap,
  } = useAnalyticsData(filters)

  // ── DataGrid sort + search ─────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    let out = catSearch
      ? rows.filter((r) => r.categoria.toLowerCase().includes(catSearch.toLowerCase()))
      : rows
    out = [...out].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      const cmp = typeof av === 'number' ? (av as number) - (bv as number) : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return out
  }, [rows, catSearch, sort])

  const handleSort = (key: SortKey) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const toggleCat = (cat: string) => {
    setSelectedCats((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat])
  }

  const clearFilters = () => {
    setSelectedCats([])
    setResponsavel('')
    setDateFrom(defaultDateFrom())
    setDateTo(defaultDateTo())
  }

  // month input value format: 'yyyy-MM'
  const toMonthInput = (d: string) => d.slice(0, 7)
  const fromMonthInput = (v: string) => v + '-01'

  // ── Dark-aware chart options ───────────────────────────────────────────────
  const trendOptions  = useMemo(() => buildTrendOptions(isDark),  [isDark])
  const donutOptions  = useMemo(() => buildDonutOptions(isDark),  [isDark])
  const barBaseOptions = useMemo(() => buildBarOptions(isDark),   [isDark])

  // ── Skeletons ─────────────────────────────────────────────────────────────
  const showSkeleton = loading && rows.length === 0

  // ── Format helpers ────────────────────────────────────────────────────────
  const fmtCompact = (v: number) =>
    v >= 1000 ? `R$ ${(v / 1000).toFixed(1)}k` : `R$ ${v.toFixed(0)}`

  const fmtFull = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  // ── Sort indicator icon ───────────────────────────────────────────────────
  const SortIcon = ({ k }: { k: SortKey }) =>
    sort.key === k ? (
      sort.dir === 'asc' ? (
        <ChevronUp className="inline w-3 h-3 ml-0.5 text-primary-500" />
      ) : (
        <ChevronDown className="inline w-3 h-3 ml-0.5 text-primary-500" />
      )
    ) : (
      <ChevronsUpDown className="inline w-3 h-3 ml-0.5 text-gray-300" />
    )

  return (
    <div className="fixed inset-0 overflow-auto z-[5] bg-gray-50 dark:bg-[#0f172a]">
      <div className="flex min-h-full">

        {/* ── Fixed Sidebar (256px) ─────────────────────────────────────────── */}
        <aside className="fixed top-0 left-0 h-screen w-64 bg-white dark:bg-[#1e293b] border-r border-gray-100 dark:border-white/[0.06] shadow-card flex flex-col overflow-y-auto z-20">

          {/* Logo / Title */}
          <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm text-gray-800 dark:text-gray-100 tracking-tight">Analytics</span>
          </div>

          <div className="flex flex-col gap-5 p-4 flex-1">

            {/* Date Range */}
            <section>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2.5">
                Período
              </span>
              <div className="flex flex-col gap-1.5">
                <input
                  type="month"
                  value={toMonthInput(dateFrom)}
                  onChange={(e) => setDateFrom(fromMonthInput(e.target.value))}
                  className="w-full text-xs rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0f172a] text-gray-700 dark:text-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                />
                <input
                  type="month"
                  value={toMonthInput(dateTo)}
                  onChange={(e) => setDateTo(fromMonthInput(e.target.value))}
                  className="w-full text-xs rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0f172a] text-gray-700 dark:text-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                />
              </div>
            </section>

            {/* Divider */}
            <div className="h-px bg-gray-100 dark:bg-white/[0.04]" />

            {/* Responsável */}
            <section>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2.5">
                Responsável
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {(['', 'Matheus', 'Jeniffer'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResponsavel(r)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-150 ${
                      responsavel === r
                        ? r === 'Matheus'
                          ? 'bg-matheus text-white shadow-sm'
                          : r === 'Jeniffer'
                          ? 'bg-jeniffer text-white shadow-sm'
                          : 'bg-primary-500 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1]'
                    }`}
                  >
                    {r === '' ? 'Todos' : r}
                  </button>
                ))}
              </div>
            </section>

            {/* Divider */}
            <div className="h-px bg-gray-100 dark:bg-white/[0.04]" />

            {/* Categories */}
            <section className="flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2.5">
                Categorias
              </span>
              <div className="flex flex-col gap-1.5">
                {CATEGORIAS_PADRAO.map((cat, i) => (
                  <label key={cat} className="flex items-center gap-2.5 cursor-pointer group py-0.5">
                    <span
                      className={`w-3 h-3 rounded flex-shrink-0 border transition-all duration-150 ${
                        selectedCats.includes(cat)
                          ? 'border-transparent scale-110'
                          : 'border-gray-300 dark:border-white/20 bg-transparent'
                      }`}
                      style={selectedCats.includes(cat) ? { backgroundColor: CAT_COLORS[i % CAT_COLORS.length] } : {}}
                    />
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedCats.includes(cat)}
                      onChange={() => toggleCat(cat)}
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors leading-none">
                      {cat}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {/* Clear */}
            {(selectedCats.length > 0 || responsavel) && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors mt-1"
              >
                <X className="w-3.5 h-3.5" />
                Limpar filtros
                {selectedCats.length > 0 && (
                  <span className="ml-auto bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                    {selectedCats.length}
                  </span>
                )}
              </button>
            )}
          </div>
        </aside>

        {/* ── Main content area ─────────────────────────────────────────────── */}
        <div className="ml-64 flex-1 flex flex-col min-w-0">

          {/* ── Sticky Header ───────────────────────────────────────────────── */}
          <header className="sticky top-0 z-10 bg-white/95 dark:bg-[rgba(15,23,42,0.96)] backdrop-blur-lg border-b border-gray-100 dark:border-white/[0.06] px-6 py-3">
            <div className="max-w-screen-2xl mx-auto flex items-center gap-4 flex-wrap">
              <KpiCard
                label="Burn Rate"
                value={fmtCompact(kpis.burnRate)}
                sub="/ mês"
                accent={kpis.burnRate > 5000 ? 'text-amber-600' : 'text-gray-800 dark:text-gray-100'}
              />
              <KpiCard
                label="Total Gasto"
                value={fmtCompact(kpis.totalGasto)}
                sub={`${kpis.totalMeses} mes${kpis.totalMeses !== 1 ? 'es' : ''}`}
                accent="text-primary-600"
              />
              <KpiCard
                label="Período"
                value={`${kpis.totalMeses} meses`}
                sub={`${dateFrom.slice(0, 7)} → ${dateTo.slice(0, 7)}`}
              />
              <KpiCard
                label="Responsável"
                value={responsavel || 'Todos'}
                accent={
                  responsavel === 'Matheus'
                    ? 'text-matheus'
                    : responsavel === 'Jeniffer'
                    ? 'text-jeniffer'
                    : 'text-gray-500 dark:text-gray-400'
                }
              />
            </div>
          </header>

          {/* ── Bento Grid + DataGrid ────────────────────────────────────────── */}
          <main className="max-w-screen-2xl mx-auto w-full px-6 py-6 space-y-4 pb-8">

            {showSkeleton ? (
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 skeleton h-96 rounded-3xl" />
                <div className="col-span-1 skeleton h-96 rounded-3xl" />
                <div className="col-span-1 skeleton h-80 rounded-3xl" />
                <div className="col-span-2 skeleton h-80 rounded-3xl" />
                <div className="col-span-3 skeleton h-64 rounded-3xl" />
              </div>
            ) : (
              <>
                {/* ── Bento row 1 ─────────────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-4">

                  {/* Trend line (2 cols) */}
                  <ChartCard title="Evolução de Gastos" className="col-span-2">
                    <div className="h-72">
                      <Line data={trendChartData} options={trendOptions} />
                    </div>
                  </ChartCard>

                  {/* Category donut (1 col) */}
                  <ChartCard title="Por Categoria" className="col-span-1">
                    <div className="h-48 flex items-center justify-center">
                      <Doughnut data={categoryDonutData} options={donutOptions} />
                    </div>
                    {/* Custom legend */}
                    <ul className="flex flex-col gap-1.5 overflow-y-auto max-h-40 pr-0.5">
                      {(categoryDonutData.labels as string[]).map((label, i) => {
                        const total = (categoryDonutData.datasets[0].data as number[]).reduce((a, b) => a + b, 0)
                        const val = categoryDonutData.datasets[0].data[i] as number
                        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0'
                        return (
                          <li key={label} className="flex items-center gap-2 min-w-0 group">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0 opacity-90"
                              style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }}
                            />
                            <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate flex-1 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors">{label}</span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500 font-semibold tabular-nums flex-shrink-0">{pct}%</span>
                          </li>
                        )
                      })}
                    </ul>
                  </ChartCard>
                </div>

                {/* ── Bento row 2 ─────────────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-4">

                  {/* Person bar (1 col) */}
                  <ChartCard title="Matheus vs Jeniffer" className="col-span-1">
                    <div className="h-64">
                      <Bar data={personBarData} options={barBaseOptions} />
                    </div>
                  </ChartCard>

                  <ChartCard title="Receitas x Despesas (Fluxo de Caixa)" className="col-span-2">
                    <div className="h-64">
                      <Bar data={cashFlowData} options={barBaseOptions} />
                    </div>
                  </ChartCard>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <ChartCard title="Despesas Planejadas vs Pagas por Mês" className="col-span-2">
                    <div className="h-64">
                      <Line data={plannedVsPaidData} options={trendOptions} />
                    </div>
                  </ChartCard>
                  <ChartCard title="Valores Restantes por Mês" className="col-span-1">
                    <div className="h-64">
                      <Line data={remainingByMonthData} options={trendOptions} />
                    </div>
                  </ChartCard>
                </div>

                <ChartCard title="Treemap de Categorias (Cartão)">
                  <div className="grid grid-cols-12 gap-2">
                    {cardCategoryTreemap.map((c) => (
                      <div
                        key={c.categoria}
                        className="relative rounded-2xl p-3 text-white min-h-20 flex flex-col justify-end transition-transform hover:scale-[1.02] cursor-default overflow-hidden"
                        style={{
                          gridColumn: `span ${Math.max(2, Math.min(12, Math.round(c.pct / 8)))}`,
                          background: `linear-gradient(135deg, ${c.color}ee, ${c.color}bb)`,
                        }}
                      >
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(0,0,0,0.06) 100%)' }}
                        />
                        <div className="relative">
                          <div className="text-[11px] font-bold truncate drop-shadow-sm">{c.categoria}</div>
                          <div className="text-[10px] opacity-80 font-semibold tabular-nums">{c.pct.toFixed(1)}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ChartCard>

                <ChartCard title="Orçamento (Previsto vs Realizado)">
                  <div className="space-y-3">
                    {budgetProgress.length === 0 && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 py-2">Sem orçamento para o mês selecionado.</div>
                    )}
                    {budgetProgress.map((b) => (
                      <div key={b.categoria} className="space-y-1.5">
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{b.categoria}</span>
                          <span className={`text-[11px] font-semibold tabular-nums ${b.pct >= 100 ? 'text-red-500' : b.pct >= 90 ? 'text-amber-500' : 'text-gray-400 dark:text-gray-500'}`}>
                            {b.pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ${b.pct < 80 ? 'bg-blue-500' : b.pct < 90 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(b.pct, 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                          <span>Gasto: {b.gasto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          <span>Previsto: {b.previsto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ChartCard>

                {/* ── DataGrid ────────────────────────────────────────────── */}
                <div className="bg-white dark:bg-[#1e293b] rounded-3xl shadow-card border border-gray-100 dark:border-white/[0.06] overflow-hidden">
                  {/* Toolbar */}
                  <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Filtrar categoria…"
                        value={catSearch}
                        onChange={(e) => setCatSearch(e.target.value)}
                        className="w-full text-sm rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0f172a] text-gray-700 dark:text-gray-200 px-3 py-1.5 pl-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                      />
                      {catSearch && (
                        <button
                          onClick={() => setCatSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums font-medium">
                      {sortedRows.length} {sortedRows.length === 1 ? 'registro' : 'registros'}
                    </span>
                  </div>

                  {/* Table */}
                  <div className="overflow-auto" style={{ maxHeight: 420 }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-[#0f172a] z-10 border-b border-gray-100 dark:border-white/[0.06]">
                        <tr>
                          {(
                            [
                              { key: 'mes' as SortKey, label: 'Mês' },
                              { key: 'categoria' as SortKey, label: 'Categoria' },
                              { key: 'responsavel' as SortKey, label: 'Responsável' },
                              { key: 'total_gasto' as SortKey, label: 'Total Gasto' },
                              { key: 'contagem' as SortKey, label: 'Qtd' },
                            ] as { key: SortKey; label: string }[]
                          ).map((col) => (
                            <th
                              key={col.key}
                              onClick={() => handleSort(col.key)}
                              className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
                            >
                              {col.label}
                              <SortIcon k={col.key} />
                            </th>
                          ))}
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest whitespace-nowrap">
                            Desvio (R$)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-white/[0.03]">
                        {sortedRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                              Nenhum dado encontrado para o período selecionado.
                            </td>
                          </tr>
                        ) : (
                          sortedRows.map((row, i) => {
                            const catIdx = CATEGORIAS_PADRAO.indexOf(row.categoria)
                            const catColor = CAT_COLORS[catIdx >= 0 ? catIdx : i % CAT_COLORS.length]
                            const budget = budgetProgress.find((b) => b.categoria === row.categoria)
                            const desvio = budget ? budget.variancia : null
                            return (
                              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs tabular-nums whitespace-nowrap font-medium">
                                  {row.mes}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span
                                    className="inline-block text-[10px] font-bold px-2.5 py-0.5 rounded-full text-white"
                                    style={{ backgroundColor: catColor }}
                                  >
                                    {row.categoria}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span
                                    className={`text-xs font-semibold ${
                                      row.responsavel === 'Matheus'
                                        ? 'text-matheus'
                                        : row.responsavel === 'Jeniffer'
                                        ? 'text-jeniffer'
                                        : 'text-gray-500 dark:text-gray-400'
                                    }`}
                                  >
                                    {row.responsavel}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right font-bold text-gray-800 dark:text-gray-100 tabular-nums text-xs whitespace-nowrap num">
                                  {fmtFull(row.total_gasto)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-gray-400 dark:text-gray-500 tabular-nums text-xs font-medium">
                                  {row.contagem}
                                </td>
                                <td className="px-4 py-2.5 text-right text-xs tabular-nums font-semibold num">
                                  {desvio === null ? (
                                    <span className="text-gray-300 dark:text-gray-600">—</span>
                                  ) : (
                                    <span className={desvio > 0 ? 'text-red-500' : desvio < 0 ? 'text-emerald-500' : 'text-gray-400'}>
                                      {desvio > 0 ? '+' : ''}{fmtFull(desvio)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
