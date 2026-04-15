'use client'

interface Transacao {
  valor: number
  responsavel: string
  categoria: string
  data_compra: string
}

interface Props {
  transacoes: Transacao[]
  carregando: boolean
}

const CAT_COLORS = [
  '#8b5cf6', '#3b82f6', '#ec4899', '#10b981',
  '#f59e0b', '#ef4444', '#06b6d4', '#6366f1',
  '#84cc16', '#f97316', '#14b8a6', '#a855f7',
]

// ── SVG bar chart ─────────────────────────────────────────────────────────────
function BarChart({
  labels,
  values,
  colors,
  height = 120,
}: {
  labels: string[]
  values: number[]
  colors: string | string[]
  height?: number
}) {
  const max = Math.max(...values, 1)
  const gap = 6
  const n = labels.length
  const svgW = 300
  const barW = n > 0 ? Math.floor((svgW - gap * (n + 1)) / n) : 0

  return (
    <svg viewBox={`0 0 ${svgW} ${height + 20}`} width="100%" style={{ display: 'block' }}>
      {values.map((v, i) => {
        const bh = Math.max((v / max) * height, v > 0 ? 4 : 0)
        const x = gap + i * (barW + gap)
        const y = height - bh
        const color = Array.isArray(colors) ? colors[i % colors.length] : colors
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={5} fill={color} />
            {v > 0 && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={11} fontWeight="700" fill={color}>
                {v}
              </text>
            )}
            <text x={x + barW / 2} y={height + 15} textAnchor="middle" fontSize={10} fill="#9ca3af">
              {labels[i]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── SVG donut chart ────────────────────────────────────────────────────────────
function DonutChart({ values, colors, size = 130 }: { values: number[]; colors: string[]; size?: number }) {
  const cx = size / 2
  const cy = size / 2
  const R = size * 0.4
  const ri = size * 0.23
  const total = values.reduce((a, v) => a + v, 0)
  if (total === 0) return null

  const paths: { d: string; color: string }[] = []
  let cumAngle = -Math.PI / 2

  for (let i = 0; i < values.length; i++) {
    const angle = (values[i] / total) * 2 * Math.PI
    const start = cumAngle
    const end = cumAngle + angle
    cumAngle = end

    const large = angle > Math.PI ? 1 : 0
    const x1 = cx + R * Math.cos(start)
    const y1 = cy + R * Math.sin(start)
    const x2 = cx + R * Math.cos(end)
    const y2 = cy + R * Math.sin(end)
    const x3 = cx + ri * Math.cos(end)
    const y3 = cy + ri * Math.sin(end)
    const x4 = cx + ri * Math.cos(start)
    const y4 = cy + ri * Math.sin(start)

    paths.push({
      d: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${ri} ${ri} 0 ${large} 0 ${x4} ${y4} Z`,
      color: colors[i % colors.length],
    })
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} />
      ))}
    </svg>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-xl shadow p-4 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-2/5 mb-3" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function GraficosDashboard({ transacoes, carregando }: Props) {
  if (carregando) return <Skeleton />
  if (transacoes.length === 0) return null

  // Dados: por pessoa
  const matheusQtd = transacoes.filter(t => t.responsavel === 'Matheus').length
  const jenifferQtd = transacoes.filter(t => t.responsavel === 'Jeniffer').length
  const matheusVal = transacoes.filter(t => t.responsavel === 'Matheus').reduce((a, t) => a + t.valor, 0)
  const jenifferVal = transacoes.filter(t => t.responsavel === 'Jeniffer').reduce((a, t) => a + t.valor, 0)

  // Dados: por dia
  const dayMap: Record<string, number> = {}
  for (const t of transacoes) {
    if (!t.data_compra) continue
    const day = t.data_compra.slice(8, 10)
    dayMap[day] = (dayMap[day] || 0) + 1
  }
  const dias = Object.keys(dayMap).sort()

  // Dados: por categoria
  const catMap: Record<string, number> = {}
  for (const t of transacoes) {
    const cat = t.categoria || 'Outros'
    catMap[cat] = (catMap[cat] || 0) + t.valor
  }
  const cats = Object.entries(catMap).sort(([, a], [, b]) => b - a)
  const totalCat = cats.reduce((a, [, v]) => a + v, 0)

  return (
    <div className="space-y-4">

      {/* Compras por pessoa */}
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-base font-semibold text-gray-800 mb-0.5">🛒 Compras por pessoa</h2>
        <p className="text-xs text-gray-400 mb-3">Quantidade de compras na fatura do mês</p>
        <BarChart
          labels={['Matheus', 'Jeniffer']}
          values={[matheusQtd, jenifferQtd]}
          colors={['#3b82f6', '#ec4899']}
          height={110}
        />
        <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-gray-100">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-xs font-medium text-gray-700">Matheus</span>
            </div>
            <p className="text-xs text-gray-500 pl-4">{matheusQtd} compras · R$ {matheusVal.toFixed(2)}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full bg-pink-500" />
              <span className="text-xs font-medium text-gray-700">Jeniffer</span>
            </div>
            <p className="text-xs text-gray-500 pl-4">{jenifferQtd} compras · R$ {jenifferVal.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Compras por dia */}
      {dias.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-base font-semibold text-gray-800 mb-0.5">📅 Compras por dia</h2>
          <p className="text-xs text-gray-400 mb-3">Quantidade de compras por dia do mês</p>
          <BarChart
            labels={dias}
            values={dias.map(d => dayMap[d])}
            colors="#8b5cf6"
            height={120}
          />
        </div>
      )}

      {/* Valor por categoria */}
      {cats.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-base font-semibold text-gray-800 mb-0.5">🏷️ Valor por categoria</h2>
          <p className="text-xs text-gray-400 mb-3">Total gasto em cada categoria</p>
          <div className="flex gap-4 items-center">
            <div className="shrink-0">
              <DonutChart values={cats.map(([, v]) => v)} colors={CAT_COLORS} size={130} />
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 130 }}>
              {cats.map(([cat, val], i) => (
                <div key={cat} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                  <p className="flex-1 text-xs text-gray-700 truncate">{cat}</p>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-semibold text-gray-700">R$ {val.toFixed(2)}</span>
                    <span className="text-xs text-gray-400 ml-1">
                      {totalCat > 0 ? ((val / totalCat) * 100).toFixed(0) : 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
