'use client'

import { useEffect, useState } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { supabase } from '@/lib/supabaseClient'
import { addMonths, format, startOfMonth } from 'date-fns'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

interface Transacao {
  valor: number
  responsavel: string
  categoria: string
  data_compra: string
}

const CAT_COLORS = [
  '#8b5cf6', '#3b82f6', '#ec4899', '#10b981',
  '#f59e0b', '#ef4444', '#06b6d4', '#6366f1',
  '#84cc16', '#f97316', '#14b8a6', '#a855f7',
]

const BAR_OPTIONS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 }, color: '#9ca3af' },
    },
    y: {
      grid: { color: '#f3f4f6' },
      ticks: { font: { size: 11 }, color: '#9ca3af', precision: 0 },
      beginAtZero: true,
    },
  },
} as const

export default function GraficosDashboard({ mesAtual }: { mesAtual: Date }) {
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { carregar() }, [mesAtual])

  async function carregar() {
    setCarregando(true)
    const mesRefFatura = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('valor, responsavel, categoria, data_compra')
      .eq('projeto_fatura', mesRefFatura)
    setTransacoes(data || [])
    setCarregando(false)
  }

  if (carregando) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl shadow p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
            <div className="h-36 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (transacoes.length === 0) return null

  // ── Gráfico 1: Quantidade por pessoa ────────────────────────────
  const matheusQtd = transacoes.filter(t => t.responsavel === 'Matheus').length
  const jenifferQtd = transacoes.filter(t => t.responsavel === 'Jeniffer').length
  const matheusVal = transacoes.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const jenifferVal = transacoes.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)

  const dadosPessoa = {
    labels: ['Matheus', 'Jeniffer'],
    datasets: [{
      label: 'Compras',
      data: [matheusQtd, jenifferQtd],
      backgroundColor: ['#3b82f6', '#ec4899'],
      borderRadius: 8,
      borderSkipped: false as const,
    }],
  }

  // ── Gráfico 2: Compras por dia ───────────────────────────────────
  const dayMap: Record<string, number> = {}
  for (const t of transacoes) {
    if (!t.data_compra) continue
    const day = t.data_compra.slice(8, 10)
    dayMap[day] = (dayMap[day] || 0) + 1
  }
  const dias = Object.keys(dayMap).sort()

  const dadosDia = {
    labels: dias,
    datasets: [{
      label: 'Compras',
      data: dias.map(d => dayMap[d]),
      backgroundColor: '#8b5cf6',
      borderRadius: 6,
      borderSkipped: false as const,
    }],
  }

  // ── Gráfico 3: Valor por categoria ──────────────────────────────
  const catMap: Record<string, number> = {}
  for (const t of transacoes) {
    const cat = t.categoria || 'Outros'
    catMap[cat] = (catMap[cat] || 0) + t.valor
  }
  const cats = Object.entries(catMap).sort(([, a], [, b]) => b - a)
  const totalCat = cats.reduce((a, [, v]) => a + v, 0)

  const dadosCategoria = {
    labels: cats.map(([c]) => c),
    datasets: [{
      data: cats.map(([, v]) => v),
      backgroundColor: cats.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]),
      borderWidth: 0,
      hoverOffset: 6,
    }],
  }

  return (
    <div className="space-y-4">

      {/* ── Compras por pessoa ── */}
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-base font-semibold text-gray-800 mb-0.5">🛒 Compras por pessoa</h2>
        <p className="text-xs text-gray-400 mb-3">Quantidade de compras na fatura do mês</p>
        <div className="relative h-36">
          <Bar
            data={dadosPessoa}
            options={{
              ...BAR_OPTIONS_BASE,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => ` ${ctx.parsed.y} compra${ctx.parsed.y !== 1 ? 's' : ''}`,
                  },
                },
              },
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              <span className="text-xs font-medium text-gray-700">Matheus</span>
            </div>
            <p className="text-xs text-gray-500 pl-4">
              {matheusQtd} compras · R$ {matheusVal.toFixed(2)}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full bg-pink-500 shrink-0" />
              <span className="text-xs font-medium text-gray-700">Jeniffer</span>
            </div>
            <p className="text-xs text-gray-500 pl-4">
              {jenifferQtd} compras · R$ {jenifferVal.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Compras por dia ── */}
      {dias.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-base font-semibold text-gray-800 mb-0.5">📅 Compras por dia</h2>
          <p className="text-xs text-gray-400 mb-3">Quantidade de compras por dia do mês</p>
          <div className="relative h-40">
            <Bar
              data={dadosDia}
              options={{
                ...BAR_OPTIONS_BASE,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => ` ${ctx.parsed.y} compra${ctx.parsed.y !== 1 ? 's' : ''}`,
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      )}

      {/* ── Valor por categoria ── */}
      {cats.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-base font-semibold text-gray-800 mb-0.5">🏷️ Valor por categoria</h2>
          <p className="text-xs text-gray-400 mb-3">Total gasto em cada categoria</p>
          <div className="flex gap-4 items-center">
            <div className="relative shrink-0" style={{ width: 140, height: 140 }}>
              <Doughnut
                data={dadosCategoria}
                options={{
                  responsive: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const val = ctx.parsed as number
                          const pct = totalCat > 0 ? ((val / totalCat) * 100).toFixed(1) : '0'
                          return ` R$ ${val.toFixed(2)} (${pct}%)`
                        },
                      },
                    },
                  },
                  cutout: '62%',
                }}
              />
            </div>
            <div className="flex-1 space-y-1.5 max-h-36 overflow-y-auto">
              {cats.map(([cat, val], i) => (
                <div key={cat} className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }}
                  />
                  <p className="flex-1 text-xs text-gray-700 truncate">{cat}</p>
                  <span className="text-xs font-medium text-gray-600 shrink-0">
                    R$ {val.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
