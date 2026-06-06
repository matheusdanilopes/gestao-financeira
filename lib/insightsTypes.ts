// Shared types for the AI insights card — usable from both client and server code

export interface InsightItem {
  icone: string
  texto: string
  nivel: 'alerta' | 'positivo' | 'info' | 'sugestao'
}

export interface InsightsResponse {
  insights: InsightItem[]
  updatedAt: string
}
