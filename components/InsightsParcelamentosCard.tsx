'use client'

import InsightsCard from '@/components/InsightsCard'
import { useParcelamentosInsights } from '@/lib/useParcelamentosInsights'

export default function InsightsParcelamentosCard() {
  const state = useParcelamentosInsights()
  return <InsightsCard state={state} title="Insights de Parcelamentos" subtitle="Baseado nos seus parcelamentos" />
}
