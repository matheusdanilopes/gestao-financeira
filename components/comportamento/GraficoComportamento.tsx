'use client'

import { useMemo } from 'react'
import { Chart } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js'
import type { ChartConfiguration } from 'chart.js'
import { useIsDark } from '@/lib/useIsDark'
import type { TemaGrafico } from '@/lib/comportamento/graficos'

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

/**
 * Renderiza uma configuração de lib/comportamento/graficos.ts na tela.
 * Carregado sob demanda (next/dynamic) para o Chart.js só baixar aqui.
 */
export default function GraficoComportamento({
  montar, altura = 220, descricao,
}: {
  montar: (tema: TemaGrafico) => ChartConfiguration<'bar'> | null
  altura?: number
  /** Texto alternativo — o gráfico em uma frase, para leitor de tela. */
  descricao: string
}) {
  const { isDark } = useIsDark()
  const config = useMemo(() => montar({ escuro: isDark }), [montar, isDark])
  if (!config) return <p className="text-xs text-gray-400 py-2">Sem dados suficientes para o gráfico.</p>

  return (
    <div style={{ height: altura }} role="img" aria-label={descricao}>
      <Chart type="bar" data={config.data} options={config.options} plugins={config.plugins} />
    </div>
  )
}
