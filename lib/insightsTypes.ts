// Shared types for the AI insights card — usable from both client and server code

export interface InsightItem {
  icone: string
  titulo: string        // short title, max ~40 chars
  detalhe: string       // metric with real value in R$, max ~80 chars
  recomendacao: string  // concrete actionable recommendation, max ~80 chars
  nivel: 'alerta' | 'positivo' | 'info' | 'sugestao'
  action?: { label: string; route: string }
}

export interface InsightsResponse {
  insights: InsightItem[]
  updatedAt: string
  source?: 'ai' | 'fallback'
}
