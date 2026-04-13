'use client'

import { useEffect, useState } from 'react'
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

const PROJECAO_OFFSET_MESES = 1

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface Props {
  onPontoClicado: (serie: string, mes: string, valor: number, itens: any[]) => void
}

export default function GraficoProjecao({ onPontoClicado }: Props) {
  const [dadosGrafico, setDadosGrafico] = useState<any>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { carregarProjecao() }, [])

  async function carregarProjecao() {
    setCarregando(true)
    const meses: string[] = []
    const inicio = startOfMonth(addMonths(new Date(), PROJECAO_OFFSET_MESES))
    for (let i = 0; i < 6; i++) {
      meses.push(format(addMonths(inicio, i), 'MMM/yyyy', { locale: ptBR }))
    }
    const res = await fetch('/api/projection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meses }),
    })
    const { total, matheus, jeniffer, extra } = await res.json()

    setDadosGrafico({
      labels: meses,
      datasets: [
        {
          label: 'Total',
          data: total,
          borderColor: 'rgb(139, 92, 246)',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 3,
          tension: 0.3,
          fill: false,
          pointRadius: 5,
          pointHoverRadius: 7,
          // mostrar labels apenas nesta série para evitar poluição visual
          datalabels: {
            display: true,
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderColor: 'rgba(139, 92, 246, 0.4)',
            borderRadius: 4,
            borderWidth: 1,
            color: '#6b21a8',
            font: { weight: 'bold', size: 10 },
            formatter: (value: number) => `R$${value.toFixed(0)}`,
            align: 'top',
            offset: 6,
            padding: { top: 2, bottom: 2, left: 4, right: 4 },
          },
        },
        {
          label: 'Matheus',
          data: matheus,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          datalabels: { display: false },
        },
        {
          label: 'Jeniffer',
          data: jeniffer,
          borderColor: 'rgb(236, 72, 153)',
          backgroundColor: 'rgba(236, 72, 153, 0.1)',
          tension: 0.3,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          datalabels: { display: false },
        },
        {
          label: 'Extra',
          data: extra,
          borderColor: 'rgb(234, 179, 8)',
          backgroundColor: 'rgba(234, 179, 8, 0.1)',
          tension: 0.3,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          datalabels: { display: false },
        },
      ],
    })
    setCarregando(false)
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
      },
      tooltip: {
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
          maxTicksLimit: 6,
        },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
      x: {
        ticks: { font: { size: 10 } },
        grid: { display: false },
      },
    },
    onClick: async (_event: any, elements: any[]) => {
      if (!elements.length) return
      const { datasetIndex, index } = elements[0]
      const serie = dadosGrafico.datasets[datasetIndex].label
      const mes = dadosGrafico.labels[index]
      const valor = dadosGrafico.datasets[datasetIndex].data[index]
      const res = await fetch('/api/projection/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serie, mes, dataIndex: index }),
      })
      const { itens } = await res.json()
      onPontoClicado(serie, mes, valor, itens)
    },
  }

  if (carregando) {
    return (
      <div className="h-80 flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-purple-500 rounded-full animate-spin" />
        <span className="text-sm">Carregando projeção...</span>
      </div>
    )
  }

  return (
    <div className="h-80">
      <Line data={dadosGrafico} options={options as any} plugins={[ChartDataLabels]} />
    </div>
  )
}
