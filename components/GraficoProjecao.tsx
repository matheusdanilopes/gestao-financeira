'use client'
import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { addMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

export default function GraficoProjecao({ onPontoClicado }) {
  const [dadosGrafico, setDadosGrafico] = useState(null)
  useEffect(() => { carregarProjecao() }, [])
  async function carregarProjecao() {
    const meses = []
    const hoje = new Date()
    for (let i = 0; i < 6; i++) meses.push(format(addMonths(hoje, i), 'MMM/yyyy', { locale: ptBR }))
    const res = await fetch('/api/projection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meses }) })
    const { total, matheus, jeniffer, extra } = await res.json()
    setDadosGrafico({ labels: meses, datasets: [
      { label: 'Total', data: total, borderColor: 'rgb(139, 92, 246)', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderWidth: 3, tension: 0.3, fill: false },
      { label: 'Matheus', data: matheus, borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.3, fill: false },
      { label: 'Jeniffer', data: jeniffer, borderColor: 'rgb(236, 72, 153)', backgroundColor: 'rgba(236, 72, 153, 0.1)', tension: 0.3, fill: false },
      { label: 'Extra', data: extra, borderColor: 'rgb(234, 179, 8)', backgroundColor: 'rgba(234, 179, 8, 0.1)', tension: 0.3, fill: false }
    ] })
  }
  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false },
      datalabels: {
        backgroundColor: 'white', borderRadius: 4, padding: 4, font: { weight: 'bold', size: 11 },
        formatter: (value) => `R$ ${value.toFixed(0)}`,
        align: 'top', offset: 4
      }
    },
    onClick: async (event, elements) => {
      if (elements.length) {
        const { datasetIndex, index } = elements[0]
        const serie = dadosGrafico.datasets[datasetIndex].label
        const mes = dadosGrafico.labels[index]
        const valor = dadosGrafico.datasets[datasetIndex].data[index]
        const res = await fetch('/api/projection/details', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serie, mes, dataIndex: index }) })
        const { itens } = await res.json()
        onPontoClicado(serie, mes, valor, itens)
      }
    }
  }
  if (!dadosGrafico) return <div className="h-80 flex items-center justify-center">Carregando...</div>
  return <div className="h-80"><Line data={dadosGrafico} options={options} plugins={[ChartDataLabels]} /></div>
}
