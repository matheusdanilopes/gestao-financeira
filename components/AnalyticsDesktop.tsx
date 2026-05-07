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

// ── Chart option objects ──────────────────────────────────────────────────────

const baseTooltip = {
  backgroundColor: 'rgba(17,24,39,0.92)',
  titleColor: '#f9fafb',
  bodyColor: '#d1d5db',
  padding: 10,
  cornerRadius: 8,
  displayColors: false,
}

const trendOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    tooltip: {
      ...baseTooltip,
      callbacks: {
        label: (ctx) =>
          ` R$ ${(ctx.parsed.y ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 }, color: '#6b7280' },
      border: { display: false },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      border: { display: false },
      ticks: {
        callback: (v) =>
          Number(v) >= 1000 ? `R$${(Number(v) / 1000).toFixed(0)}k` : `R$${v}`,
        font: { size: 11 },
        color: '#9ca3af',
        maxTicksLimit: 5,
      },
    },
  },
}

const donutOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    tooltip: {
      ...baseTooltip,
      displayColors: true,
      callbacks: {
        label: (ctx) => {
          const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0)
          const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'
          return ` R$ ${ctx.parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pct}%)`
        },
      },
    },
  },
}

const barBaseOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    datalabels: { display: false },
    legend: { position: 'top', labels: { font: { size: 11 }, usePointStyle: true, boxHeight: 8, padding: 12 } },
    tooltip: {
      ...baseTooltip,
      displayColors: true,
      callbacks: {
        label: (ctx) =>
          ` R$ ${(ctx.parsed.y ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6b7280' }, border: { display: false } },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      border: { display: false },
      ticks: {
        callback: (v) =>
          Number(v) >= 1000 ? `R$${(Number(v) / 1000).toFixed(0)}k` : `R$${v}`,
        font: { size: 11 },
        color: '#9ca3af',
        maxTicksLimit: 5,
      },
    },
  },
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = keyof AnalyticsMensalRow
interface SortConfig { key: SortKey; dir: 'asc' | 'desc' }

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-[#1e293b] rounded-2xl shadow-card border border-gray-100 dark:border-white/[0.06] px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      <span className={`text-xl font-bold leading-tight truncate ${accent ?? 'text-gray-800 dark:text-gray-100'}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-gray-400">{sub}</span>}
    </div>
  )
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-[#1e293b] rounded-3xl shadow-card border border-gray-100 dark:border-white/[0.06] p-5 flex flex-col gap-3 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h3>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsDesktop() {
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
    yoyBarData,
    kpis,
    cashFlowData,
    investmentAllocationData,
    netWorthTrendData,
    budgetProgress,
    financeMetrics,
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
            <div className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm text-gray-800 dark:text-gray-100">Analytics</span>
          </div>

          <div className="flex flex-col gap-5 p-4 flex-1">

            {/* Date Range */}
            <section>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Período
              </span>
              <div className="flex flex-col gap-1.5">
                <input
                  type="month"
                  value={toMonthInput(dateFrom)}
                  onChange={(e) => setDateFrom(fromMonthInput(e.target.value))}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0f172a] text-gray-700 dark:text-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                <input
                  type="month"
                  value={toMonthInput(dateTo)}
                  onChange={(e) => setDateTo(fromMonthInput(e.target.value))}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0f172a] text-gray-700 dark:text-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </section>

            {/* Responsável */}
            <section>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Responsável
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {(['', 'Matheus', 'Jeniffer'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResponsavel(r)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      responsavel === r
                        ? r === 'Matheus'
                          ? 'bg-matheus text-white'
                          : r === 'Jeniffer'
                          ? 'bg-jeniffer text-white'
                          : 'bg-primary-500 text-white'
                        : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1]'
                    }`}
                  >
                    {r === '' ? 'Todos' : r}
                  </button>
                ))}
              </div>
            </section>

            {/* Categories */}
            <section className="flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Categorias
              </span>
              <div className="flex flex-col gap-1">
                {CATEGORIAS_PADRAO.map((cat, i) => (
                  <label key={cat} className="flex items-center gap-2 cursor-pointer group">
                    <span
                      className={`w-3 h-3 rounded-sm flex-shrink-0 border transition-colors ${
                        selectedCats.includes(cat)
                          ? 'border-transparent'
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
                    <span className="text-xs text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors">
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
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Limpar filtros
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
                    <div className="h-52">
                      <Doughnut data={categoryDonutData} options={donutOptions} />
                    </div>
                    {/* Custom legend */}
                    <ul className="flex flex-col gap-1 overflow-y-auto max-h-36">
                      {(categoryDonutData.labels as string[]).map((label, i) => {
                        const total = (categoryDonutData.datasets[0].data as number[]).reduce((a, b) => a + b, 0)
                        const val = categoryDonutData.datasets[0].data[i] as number
                        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0'
                        return (
                          <li key={label} className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }}
                            />
                            <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate flex-1">{label}</span>
                            <span className="text-[11px] text-gray-400 font-medium flex-shrink-0">{pct}%</span>
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

                  {/* YoY comparison (2 cols) — desktop-exclusive feature */}
                  <ChartCard title="Comparativo Anual (Year-over-Year)" className="col-span-2">
                    <div className="h-64">
                      <Bar data={yoyBarData} options={barBaseOptions} />
                    </div>
                  </ChartCard>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <ChartCard title="Receitas x Despesas (Fluxo de Caixa)" className="col-span-2">
                    <div className="h-64">
                      <Bar data={cashFlowData} options={{ ...barBaseOptions, scales: { ...barBaseOptions.scales, x: { ...barBaseOptions.scales?.x, stacked: true }, y: { ...barBaseOptions.scales?.y, stacked: true } } }} />
                    </div>
                  </ChartCard>
                  <div className="grid grid-rows-2 gap-4 col-span-1">
                    <KpiCard label="Receita Total (Mês Atual)" value={fmtFull(financeMetrics.receitaMes)} accent="text-emerald-600" />
                    <KpiCard label="Taxa de Poupança" value={`${financeMetrics.taxaPoupanca.toFixed(1)}%`} sub="((Receita - Despesas) / Receita)" accent="text-blue-600" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <ChartCard title="Alocação por Tipo de Ativo" className="col-span-1">
                    <div className="h-56"><Doughnut data={investmentAllocationData} options={donutOptions} /></div>
                  </ChartCard>
                  <ChartCard title="Evolução do Patrimônio (12 meses)" className="col-span-2">
                    <div className="h-56"><Line data={netWorthTrendData} options={trendOptions} /></div>
                    <div className="text-xs text-gray-500">Runway estimado: <span className="font-semibold">{financeMetrics.runwayMeses.toFixed(1)} meses</span></div>
                  </ChartCard>
                </div>

                <ChartCard title="Orçamento (Previsto vs Realizado)">
                  <div className="space-y-2">
                    {budgetProgress.length === 0 && <div className="text-xs text-gray-400">Sem orçamento para o mês selecionado.</div>}
                    {budgetProgress.map((b) => (
                      <div key={b.categoria} className="space-y-1">
                        <div className="flex justify-between text-xs"><span>{b.categoria}</span><span>{b.gasto.toLocaleString('pt-BR')} / {b.previsto.toLocaleString('pt-BR')}</span></div>
                        <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className={`h-full ${b.pct < 80 ? 'bg-blue-500' : b.pct <= 100 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${Math.min(b.pct, 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </ChartCard>

                {/* ── DataGrid ────────────────────────────────────────────── */}
                <div className="bg-white dark:bg-[#1e293b] rounded-3xl shadow-card border border-gray-100 dark:border-white/[0.06] overflow-hidden">
                  {/* Toolbar */}
                  <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-3">
                    <input
                      type="text"
                      placeholder="Filtrar categoria…"
                      value={catSearch}
                      onChange={(e) => setCatSearch(e.target.value)}
                      className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0f172a] text-gray-700 dark:text-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                    <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                      {sortedRows.length} registros
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
                              className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
                            >
                              {col.label}
                              <SortIcon k={col.key} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                        {sortedRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                              Nenhum dado encontrado para o período selecionado.
                            </td>
                          </tr>
                        ) : (
                          sortedRows.map((row, i) => {
                            const catIdx = CATEGORIAS_PADRAO.indexOf(row.categoria)
                            const catColor = CAT_COLORS[catIdx >= 0 ? catIdx : i % CAT_COLORS.length]
                            return (
                              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                                <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs tabular-nums whitespace-nowrap">
                                  {row.mes}
                                </td>
                                <td className="px-4 py-2">
                                  <span
                                    className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                                    style={{ backgroundColor: catColor }}
                                  >
                                    {row.categoria}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  <span
                                    className={`text-xs font-semibold ${
                                      row.responsavel === 'Matheus'
                                        ? 'text-matheus'
                                        : row.responsavel === 'Jeniffer'
                                        ? 'text-jeniffer'
                                        : 'text-gray-500'
                                    }`}
                                  >
                                    {row.responsavel}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right font-semibold text-gray-800 dark:text-gray-100 tabular-nums text-xs whitespace-nowrap">
                                  {fmtFull(row.total_gasto)}
                                </td>
                                <td className="px-4 py-2 text-right text-gray-400 tabular-nums text-xs">
                                  {row.contagem}
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
