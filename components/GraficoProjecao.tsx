'use client'

import { useEffect, useMemo, useState } from 'react'
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
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { addMonths, format, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { MousePointerClick, AlertCircle } from 'lucide-react'

const PROJECAO_OFFSET_MESES = 1

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface Props {
  mesInicio?: Date
  onPontoClicado: (serie: string, mes: string, valor: number, itens: any[]) => void
}

export default function GraficoProjecao({ mesInicio, onPontoClicado }: Props) {
  const [dadosGrafico, setDadosGrafico] = useState<any>(null)
  const [mesesDatas, setMesesDatas] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { carregarProjecao() }, [mesInicio])

  async function carregarProjecao() {
    setCarregando(true)
    setErro(null)
    try {
      const base = mesInicio ? startOfMonth(mesInicio) : new Date()
      const inicio = startOfMonth(addMonths(base, PROJECAO_OFFSET_MESES))

      const meses: string[] = []
      const datas: string[] = []
      for (let i = 0; i < 6; i++) {
        const m = addMonths(inicio, i)
        meses.push(format(m, 'MMM/yyyy', { locale: ptBR }))
        datas.push(format(startOfMonth(m), 'yyyy-MM-dd'))
      }

      const res = await fetch('/api/projection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meses, inicioStr: datas[0] }),
      })
      if (!res.ok) throw new Error('Falha ao carregar projeção')
      const { total, matheus, jeniffer, extra } = await res.json()

      setMesesDatas(datas)
      setDadosGrafico({
        labels: meses,
        datasets: [
          {
            label: 'Total',
            data: total,
            borderColor: 'rgb(109, 40, 217)',
            backgroundColor: 'rgba(109, 40, 217, 0.08)',
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBackgroundColor: 'rgb(109, 40, 217)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            datalabels: {
              display: true,
              backgroundColor: 'rgb(109, 40, 217)',
              borderRadius: 5,
              color: '#fff',
              font: { weight: 'bold' as const, size: 10 },
              formatter: (value: number) => `R$${value.toFixed(0)}`,
              align: 'top' as const,
              offset: 8,
              padding: { top: 3, bottom: 3, left: 5, right: 5 },
            },
          },
          {
            label: 'Matheus',
            data: matheus,
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: 1.5,
            tension: 0.35,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: 'rgb(59, 130, 246)',
            datalabels: { display: false },
          },
          {
            label: 'Jeniffer',
            data: jeniffer,
            borderColor: 'rgb(236, 72, 153)',
            borderWidth: 1.5,
            tension: 0.35,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: 'rgb(236, 72, 153)',
            datalabels: { display: false },
          },
          {
            label: 'Extra',
            data: extra,
            borderColor: 'rgb(234, 179, 8)',
            borderWidth: 1.5,
            borderDash: [5, 4],
            tension: 0.35,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: 'rgb(234, 179, 8)',
            datalabels: { display: false },
          },
        ],
      })
    } catch (e) {
      setErro('Não foi possível carregar a projeção.')
    } finally {
      setCarregando(false)
    }
  }

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          font: { size: 11 },
          boxWidth: 10,
          boxHeight: 10,
          padding: 16,
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(17,24,39,0.92)',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: any) => ` ${ctx.dataset.label}: R$ ${ctx.parsed.y.toFixed(2)}`,
        },
      },
      datalabels: {},
    },
    scales: {
      y: {
        ticks: {
          callback: (value: any) => `R$${Number(value).toFixed(0)}`,
          font: { size: 10 },
          maxTicksLimit: 5,
          color: '#9ca3af',
        },
        grid: { color: 'rgba(0,0,0,0.04)' },
        border: { display: false },
      },
      x: {
        ticks: { font: { size: 10 }, color: '#6b7280' },
        grid: { display: false },
        border: { display: false },
      },
    },
    onClick: async (_event: any, elements: any[]) => {
      if (!elements.length) return
      const { datasetIndex, index } = elements[0]
      const serie = dadosGrafico.datasets[datasetIndex].label
      const mes = dadosGrafico.labels[index]
      const valor = dadosGrafico.datasets[datasetIndex].data[index]
      const mesStr = mesesDatas[index]
      try {
        const res = await fetch('/api/projection/details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serie, mesStr }),
        })
        const { itens } = await res.json()
        onPontoClicado(serie, mes, valor, itens)
      } catch (e) {
        console.error('[GraficoProjecao] Erro ao carregar detalhes:', e)
      }
    },
  }), [dadosGrafico, mesesDatas, onPontoClicado])

  if (carregando) {
    return (
      <div className="h-72 flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-purple-500 rounded-full animate-spin" />
        <span className="text-sm">Carregando projeção…</span>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="h-72 flex flex-col items-center justify-center gap-3 text-red-400">
        <AlertCircle className="w-8 h-8" />
        <span className="text-sm">{erro}</span>
        <button onClick={carregarProjecao} className="text-xs text-blue-500 underline">Tentar novamente</button>
      </div>
    )
  }

  return (
    <div>
      <div className="h-72">
        <Line data={dadosGrafico} options={options} plugins={[ChartDataLabels]} />
      </div>
      <p className="flex items-center justify-center gap-1 text-[11px] text-gray-400 mt-3">
        <MousePointerClick className="w-3.5 h-3.5" />
        Toque em um ponto para ver as parcelas do mês
      </p>
    </div>
  )
}
