// Catálogo central de tipos de notificação, metadados de rota, estilo e lifecycle.
// Toda lógica de "onde navegar" e "como fechar" parte deste arquivo.

export type NotificacaoTipo =
  // Importação
  | 'importacao_iniciada'
  | 'importacao_processando'
  | 'importacao_concluida'
  | 'importacao_erro'
  | 'categorizacao_concluida'
  // Wishlist
  | 'wishlist_novo_item'
  | 'wishlist_item_ia'
  | 'wishlist_item_concluido'
  // Lista Mercado
  | 'lista_compra_finalizada'
  | 'lista_sincronizacao'
  | 'lista_item_compartilhado'
  // Pedidos / Compras
  | 'pedido_criado'
  | 'pedido_pendente'
  | 'pedido_cancelado'
  | 'pedido_concluido'
  // Financeiro
  | 'conta_vencendo'
  | 'conta_atrasada'
  | 'pagamento_registrado'
  | 'assinatura_alterada'
  // Ações financeiras (legado)
  | 'aporte'
  | 'pagar'
  | 'receber'
  // Conciliação
  | 'conciliacao_conflito'
  // IA
  | 'ia_processamento_concluido'
  | 'ia_falha'
  | 'ia_analise_pronta'

export type GrupoNotificacao =
  | 'importacao'
  | 'wishlist'
  | 'mercado'
  | 'financeiro'
  | 'ia'
  | 'acoes'
  | 'pedidos'
  | 'conciliacao'

export interface NotificacaoMeta {
  /** Rota base de destino */
  rota: string
  /** Constrói URL dinâmica quando metadata tem contexto (ex: item_id) */
  rotaFn?: (metadata: Record<string, unknown> | null | undefined) => string
  grupo: GrupoNotificacao
  /** text-* Tailwind para o ícone */
  corIcone: string
  /** border-l-* Tailwind */
  corBorda: string
  /** bg-* Tailwind para estado não-lido */
  corFundo: string
  /** Tag usada no notification tray do OS para agrupamento */
  pushTag: string
  /** Fecha automaticamente ao abrir o app (processo concluído, só informativo) */
  autoFechar: boolean
  /** requireInteraction no push — exige ação do usuário */
  exigeInteracao: boolean
  /** Rótulo legível para agrupamento visual na bandeja */
  rotulo: string
}

export const NOTIFICACAO_META: Record<string, NotificacaoMeta> = {
  // ── Importação ──────────────────────────────────────────────────────────────
  importacao_iniciada: {
    rota: '/importar',
    grupo: 'importacao',
    corIcone: 'text-blue-500',
    corBorda: 'border-l-blue-400',
    corFundo: 'bg-blue-50/40 dark:bg-blue-900/10',
    pushTag: 'importacao',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Importação',
  },
  importacao_processando: {
    rota: '/importar',
    grupo: 'importacao',
    corIcone: 'text-blue-500',
    corBorda: 'border-l-blue-400',
    corFundo: 'bg-blue-50/40 dark:bg-blue-900/10',
    pushTag: 'importacao',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Importação',
  },
  importacao_concluida: {
    rota: '/importar',
    grupo: 'importacao',
    corIcone: 'text-green-500',
    corBorda: 'border-l-green-400',
    corFundo: 'bg-green-50/40 dark:bg-green-900/10',
    pushTag: 'importacao-sucesso',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Importação',
  },
  importacao_erro: {
    rota: '/importar',
    grupo: 'importacao',
    corIcone: 'text-red-500',
    corBorda: 'border-l-red-400',
    corFundo: 'bg-red-50/40 dark:bg-red-900/10',
    pushTag: 'importacao-erro',
    autoFechar: false,
    exigeInteracao: true,
    rotulo: 'Importação',
  },
  categorizacao_concluida: {
    rota: '/compras',
    grupo: 'importacao',
    corIcone: 'text-indigo-500',
    corBorda: 'border-l-indigo-400',
    corFundo: 'bg-indigo-50/40 dark:bg-indigo-900/10',
    pushTag: 'categorizacao',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Categorização',
  },

  // ── Wishlist ─────────────────────────────────────────────────────────────────
  wishlist_novo_item: {
    rota: '/wishlist',
    rotaFn: () => '/wishlist?ordem=mais-novo',
    grupo: 'wishlist',
    corIcone: 'text-pink-500',
    corBorda: 'border-l-pink-400',
    corFundo: 'bg-pink-50/40 dark:bg-pink-900/10',
    pushTag: 'wishlist',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Wishlist',
  },
  wishlist_item_ia: {
    rota: '/wishlist',
    rotaFn: (meta) =>
      meta && typeof meta.wishlist_item_id === 'string' && meta.wishlist_item_id
        ? `/wishlist?item=${meta.wishlist_item_id}`
        : '/wishlist',
    grupo: 'wishlist',
    corIcone: 'text-pink-500',
    corBorda: 'border-l-pink-400',
    corFundo: 'bg-pink-50/40 dark:bg-pink-900/10',
    pushTag: 'wishlist-ia',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Wishlist IA',
  },
  wishlist_item_concluido: {
    rota: '/wishlist',
    rotaFn: () => '/wishlist?realizado=true',
    grupo: 'wishlist',
    corIcone: 'text-pink-500',
    corBorda: 'border-l-pink-400',
    corFundo: 'bg-pink-50/40 dark:bg-pink-900/10',
    pushTag: 'wishlist-concluido',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Wishlist',
  },

  // ── Lista Mercado ─────────────────────────────────────────────────────────────
  lista_compra_finalizada: {
    rota: '/lista-mercado',
    grupo: 'mercado',
    corIcone: 'text-teal-500',
    corBorda: 'border-l-teal-400',
    corFundo: 'bg-teal-50/40 dark:bg-teal-900/10',
    pushTag: 'lista-mercado',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Lista Mercado',
  },
  lista_sincronizacao: {
    rota: '/lista-mercado',
    grupo: 'mercado',
    corIcone: 'text-teal-500',
    corBorda: 'border-l-teal-400',
    corFundo: 'bg-teal-50/40 dark:bg-teal-900/10',
    pushTag: 'lista-sincronizacao',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Lista Mercado',
  },
  lista_item_compartilhado: {
    rota: '/lista-mercado',
    grupo: 'mercado',
    corIcone: 'text-teal-500',
    corBorda: 'border-l-teal-400',
    corFundo: 'bg-teal-50/40 dark:bg-teal-900/10',
    pushTag: 'lista-compartilhado',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Lista Mercado',
  },

  // ── Pedidos ────────────────────────────────────────────────────────────────
  pedido_criado: {
    rota: '/compras',
    grupo: 'pedidos',
    corIcone: 'text-indigo-500',
    corBorda: 'border-l-indigo-400',
    corFundo: 'bg-indigo-50/40 dark:bg-indigo-900/10',
    pushTag: 'pedido',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Pedido',
  },
  pedido_pendente: {
    rota: '/compras',
    grupo: 'pedidos',
    corIcone: 'text-amber-500',
    corBorda: 'border-l-amber-400',
    corFundo: 'bg-amber-50/40 dark:bg-amber-900/10',
    pushTag: 'pedido-pendente',
    autoFechar: false,
    exigeInteracao: true,
    rotulo: 'Pedido Pendente',
  },
  pedido_cancelado: {
    rota: '/compras',
    grupo: 'pedidos',
    corIcone: 'text-red-500',
    corBorda: 'border-l-red-400',
    corFundo: 'bg-red-50/40 dark:bg-red-900/10',
    pushTag: 'pedido-cancelado',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Pedido Cancelado',
  },
  pedido_concluido: {
    rota: '/compras',
    grupo: 'pedidos',
    corIcone: 'text-green-500',
    corBorda: 'border-l-green-400',
    corFundo: 'bg-green-50/40 dark:bg-green-900/10',
    pushTag: 'pedido-concluido',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Pedido Concluído',
  },

  // ── Financeiro ─────────────────────────────────────────────────────────────
  conta_vencendo: {
    rota: '/contas',
    grupo: 'financeiro',
    corIcone: 'text-amber-500',
    corBorda: 'border-l-amber-400',
    corFundo: 'bg-amber-50/40 dark:bg-amber-900/10',
    pushTag: 'conta-vencendo',
    autoFechar: false,
    exigeInteracao: true,
    rotulo: 'Vencimento',
  },
  conta_atrasada: {
    rota: '/contas',
    grupo: 'financeiro',
    corIcone: 'text-red-500',
    corBorda: 'border-l-red-400',
    corFundo: 'bg-red-50/40 dark:bg-red-900/10',
    pushTag: 'conta-atrasada',
    autoFechar: false,
    exigeInteracao: true,
    rotulo: 'Conta Atrasada',
  },
  pagamento_registrado: {
    rota: '/financas',
    grupo: 'financeiro',
    corIcone: 'text-green-500',
    corBorda: 'border-l-green-400',
    corFundo: 'bg-green-50/40 dark:bg-green-900/10',
    pushTag: 'pagamento',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Pagamento',
  },
  assinatura_alterada: {
    rota: '/assinaturas',
    grupo: 'financeiro',
    corIcone: 'text-purple-500',
    corBorda: 'border-l-purple-400',
    corFundo: 'bg-purple-50/40 dark:bg-purple-900/10',
    pushTag: 'assinatura',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Assinatura',
  },

  // ── Ações financeiras (legado) ─────────────────────────────────────────────
  aporte: {
    rota: '/dashboard',
    grupo: 'acoes',
    corIcone: 'text-green-500',
    corBorda: 'border-l-green-400',
    corFundo: 'bg-blue-50/40 dark:bg-blue-900/10',
    pushTag: 'aporte',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Aporte',
  },
  pagar: {
    rota: '/contas',
    grupo: 'acoes',
    corIcone: 'text-blue-500',
    corBorda: 'border-l-blue-400',
    corFundo: 'bg-blue-50/40 dark:bg-blue-900/10',
    pushTag: 'pagar',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Pagamento',
  },
  receber: {
    rota: '/receitas',
    grupo: 'acoes',
    corIcone: 'text-purple-500',
    corBorda: 'border-l-purple-400',
    corFundo: 'bg-blue-50/40 dark:bg-blue-900/10',
    pushTag: 'receber',
    autoFechar: false,
    exigeInteracao: false,
    rotulo: 'Recebimento',
  },

  // ── Conciliação ────────────────────────────────────────────────────────────
  conciliacao_conflito: {
    rota: '/compras',
    grupo: 'conciliacao',
    corIcone: 'text-amber-500',
    corBorda: 'border-l-amber-400',
    corFundo: 'bg-amber-50/60 dark:bg-amber-900/10',
    pushTag: 'conciliacao',
    autoFechar: false,
    exigeInteracao: true,
    rotulo: 'Conciliação',
  },

  // ── IA ─────────────────────────────────────────────────────────────────────
  ia_processamento_concluido: {
    rota: '/chat',
    grupo: 'ia',
    corIcone: 'text-violet-500',
    corBorda: 'border-l-violet-400',
    corFundo: 'bg-violet-50/40 dark:bg-violet-900/10',
    pushTag: 'ia-processamento',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'IA',
  },
  ia_falha: {
    rota: '/chat',
    grupo: 'ia',
    corIcone: 'text-red-500',
    corBorda: 'border-l-red-400',
    corFundo: 'bg-red-50/40 dark:bg-red-900/10',
    pushTag: 'ia-falha',
    autoFechar: false,
    exigeInteracao: true,
    rotulo: 'IA',
  },
  ia_analise_pronta: {
    rota: '/analytics',
    grupo: 'ia',
    corIcone: 'text-violet-500',
    corBorda: 'border-l-violet-400',
    corFundo: 'bg-violet-50/40 dark:bg-violet-900/10',
    pushTag: 'ia-analise',
    autoFechar: true,
    exigeInteracao: false,
    rotulo: 'Análise IA',
  },
}

const NOTIFICACAO_META_DEFAULT: NotificacaoMeta = {
  rota: '/dashboard',
  grupo: 'acoes',
  corIcone: 'text-gray-400',
  corBorda: 'border-l-gray-300',
  corFundo: 'bg-blue-50/40 dark:bg-blue-900/10',
  pushTag: 'gestao-push',
  autoFechar: false,
  exigeInteracao: false,
  rotulo: 'Notificação',
}

export function getNotificacaoMeta(acao: string): NotificacaoMeta {
  return NOTIFICACAO_META[acao] ?? NOTIFICACAO_META_DEFAULT
}

// Rotas → tipos de notificação que devem ser marcados como lidos ao abrir a tela
export const ROTA_PARA_ACOES: Record<string, string[]> = {
  '/wishlist':      ['wishlist_novo_item', 'wishlist_item_ia', 'wishlist_item_concluido'],
  '/contas':        ['conta_vencendo', 'conta_atrasada', 'pagar'],
  '/importar':      ['importacao_iniciada', 'importacao_processando', 'importacao_concluida'],
  '/compras':       ['categorizacao_concluida', 'pedido_criado', 'pedido_pendente', 'pedido_cancelado', 'pedido_concluido'],
  '/dashboard':     ['aporte'],
  '/receitas':      ['receber'],
  '/lista-mercado': ['lista_compra_finalizada', 'lista_sincronizacao', 'lista_item_compartilhado'],
  '/financas':      ['pagamento_registrado'],
  '/assinaturas':   ['assinatura_alterada'],
  '/chat':          ['ia_processamento_concluido', 'ia_falha'],
  '/analytics':     ['ia_analise_pronta'],
}

// Tags do SW que devem fechar automaticamente quando o app é aberto/retomado.
// Mantido em sincronia com AUTO_CLOSE_TAGS em public/sw.js.
// Importações de sucesso são fechadas por prefixo (closeImportSuccessNotifications),
// portanto 'importacao' e 'importacao-sucesso' não constam aqui (PR #142).
export const SW_AUTO_CLOSE_TAGS = [
  'categorizacao',
  'wishlist-concluido',
  'lista-mercado',
  'lista-sincronizacao',
  'pedido-concluido',
  'pagamento',
  'ia-processamento',
  'ia-analise',
]
