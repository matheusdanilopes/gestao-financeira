// Shared types for the AI context system

export type Responsavel = 'Matheus' | 'Jeniffer'

export interface Transacao {
  descricao: string
  valor: number
  responsavel: string
  categoria: string | null
  projeto_fatura: string
  data: string
  cartao?: string
  parcela_atual?: number | null
  total_parcelas?: number | null
}

export interface Planejamento {
  id?: string
  item: string
  responsavel: string | null
  valor_previsto: number
  categoria: string | null
  mes_referencia: string
  parcela_atual: number | null
  total_parcelas: number | null
  data_vencimento?: string | null
  data_pagamento?: string | null
  // Used by receitas ([RECEITA] items): valor_real = actual amount received,
  // pago = whether it has been (fully) received.
  valor_real?: number | null
  pago?: boolean | null
}

export interface Estorno {
  descricao: string
  valor: number
  data: string
  cartao?: string
  projeto_fatura: string
  status: string
}

export interface Assinatura {
  nome: string
  valor: number
  cartao: string
  responsavel: string
  categoria: string
  ativa: boolean
  dia_cobranca?: number | null
  /** Pausa temporária: a assinatura volta a ser cobrada nesta data. */
  pausada_ate?: string | null
}

export interface Investimento {
  id: string
  descricao: string
  percentual: number
  mes_referencia: string
}

export interface AporteInvestimento {
  investimento_id: string
  valor: number
  data_aporte: string
  observacao?: string | null
  /** Saldo do investimento informado pelo usuário ao registrar este aporte. */
  saldo_atual?: number | null
}

export interface Configuracao {
  chave: string
  valor: string
}

/** Limite mensal de parcelamentos por pessoa (vale até o próximo registro). */
export interface LimiteParcelamento {
  mes_referencia: string
  responsavel: string
  valor: number
}

/** Recebimento (possivelmente parcial) de uma receita do planejamento. */
export interface RecebimentoReceita {
  planejamento_id: string
  valor: number
  data_recebimento: string | null
}

/** Datas de fechamento registradas por fatura (mes_referencia = projeto_fatura). */
export interface FaturaFechamento {
  cartao: string
  mes_referencia: string
  data_fechamento: string
}

export interface ItemDesejo {
  nome: string
  valor_estimado: number | null
  prioridade: string
  realizado: boolean
  categoria?: string | null
  criado_por?: string | null
}

export interface ItemMercado {
  nome: string
  quantidade: number
  preco_unit: number | null
  comprado: boolean
}

export interface ItemListaCompras {
  lista: string
  nome: string
  quantidade: number
  pessoa: string | null
  preco_previsto: number | null
  preco_pago: number | null
  status: string
}

export interface EnrichedData {
  transacoes: Transacao[]
  planejamento: Planejamento[]
  assinaturas: Assinatura[]
  investimentos: Investimento[]
  aportes: AporteInvestimento[]
  configuracoes: Configuracao[]
  estornos: Estorno[]
  limites?: LimiteParcelamento[]
  recebimentos?: RecebimentoReceita[]
  faturas?: FaturaFechamento[]
  desejos?: ItemDesejo[]
  mercado?: ItemMercado[]
  listasCompras?: ItemListaCompras[]
  /** Fontes secundárias que falharam ao carregar — o agente precisa saber. */
  avisos?: string[]
  ts: number
}

export interface CategoryMetric {
  categoria: string
  valor: number
  percentual: number
  anterior?: number
  variacao?: number
}

export interface FinancialInsightsContext {
  mesAtual: string
  mesAnterior: string
  // Billing month (addMonths(hoje,1)) that totalGastos/gastoMatheus/gastoJeniffer
  // are actually keyed to — distinct from mesAtual (calendar month). Exists so
  // labels can say exactly which month a card figure belongs to instead of
  // implying it's mesAtual's.
  mesFaturaAtual: string
  diaAtual: number
  totalGastos: number
  totalGastosAnterior: number
  variacaoGastos: number
  gastoMatheus: number
  gastoJeniffer: number
  topCategorias: CategoryMetric[]
  maioresGastos: Array<{ descricao: string; valor: number; categoria: string; responsavel: string; cartao: string }>
  gastoPorCartao: Record<string, number>
  comprasParceladas: { count: number; totalValor: number }
  totalAssinaturas: number
  assinaturasAtivas: number
  assinaturasPorCategoria: Record<string, number>
  totalOrcado: number
  totalPago: number
  despesasEmAberto: number
  itensPlanejamentoEmAberto: Array<{ item: string; valor: number; vencimento?: string }>
  itensVencidos: Array<{ item: string; valor: number; vencimento: string }>
  itensVencendo7d: Array<{ item: string; valor: number; vencimento: string }>
  totalAportesHistorico: number
  aportesRecentes: Array<{ descricao: string; valor: number; data: string }>
  mediaMensalHistorica: number
  mediaCartaoHistorica: number
  totalCartaoAnterior: number
  tendencia: 'alta' | 'baixa' | 'estavel'
  tendenciaPct: number
  rendaMensal?: number
  sobraLiquida?: number
  taxaPoupanca?: number
}

export type TelaAtual =
  | 'dashboard'
  | 'compras'
  | 'financas'
  | 'investimentos'
  | 'assinaturas'
  | 'wishlist'
  | 'lista-mercado'
  | 'extras'
  | 'receitas'
  | 'analytics'
  | 'geral'

export interface ChatRequestContext {
  userId: string
  pergunta: string
  tela?: TelaAtual
}

// ─── Validation layer types ───────────────────────────────────────────────────

export type ValidationIssueType =
  | 'duplicate'
  | 'card_payment'
  | 'investment_redemption'
  | 'installment_double_count'
  | 'anomaly'
  | 'math_inconsistency'

export interface ValidationIssue {
  type: ValidationIssueType
  severity: 'critical' | 'warning' | 'info'
  descricao: string
  valor?: number
  transacoes?: string[]
}

export interface ValidationCertificate {
  timestamp: string
  indiceConfiabilidade: number   // 0–100
  totalTransacoes: number
  transacoesValidadas: number
  transacoesExcluidas: number
  problemas: ValidationIssue[]
  certificado: boolean           // false when critical issues block AI
  resumo: string
}
