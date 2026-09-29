/**
 * Tipos de aviso que o bot do Telegram manda por conta própria (sem a pessoa
 * perguntar). Cada pessoa liga ou desliga cada tipo na tela de Configurações;
 * a escolha fica em telegram_vinculos.notificacoes ({ "vencimento": false }).
 * Tipo ausente = ligado, para um tipo novo já chegar a quem conectou antes.
 *
 * Sem dependências de servidor: a tela de Configurações também importa isto.
 */

export type CategoriaNotificacaoTelegram =
  | 'vencimento'
  | 'resumo_semanal'
  | 'importacao'
  | 'movimentacoes'
  | 'mercado'
  | 'wishlist'

export interface InfoCategoriaTelegram {
  id: CategoriaNotificacaoTelegram
  titulo: string
  descricao: string
}

export const CATEGORIAS_NOTIFICACAO_TELEGRAM: InfoCategoriaTelegram[] = [
  { id: 'vencimento', titulo: 'Contas a vencer', descricao: 'Na véspera e no dia do vencimento, às 09:00' },
  { id: 'resumo_semanal', titulo: 'Resumo semanal', descricao: 'Gastos da semana, toda segunda às 09:00' },
  { id: 'importacao', titulo: 'Importação de faturas', descricao: 'Compras novas, estornos e falhas na importação' },
  { id: 'movimentacoes', titulo: 'Pagamentos e aportes', descricao: 'Quando a outra pessoa registra pagamento, receita ou aporte' },
  { id: 'mercado', titulo: 'Lista de mercado', descricao: 'Itens adicionados pela outra pessoa' },
  { id: 'wishlist', titulo: 'Wishlist', descricao: 'Desejos novos da outra pessoa' },
]

export type PreferenciasNotificacaoTelegram = Partial<Record<CategoriaNotificacaoTelegram, boolean>>

export function categoriaAtiva(
  prefs: PreferenciasNotificacaoTelegram | null | undefined,
  categoria: CategoriaNotificacaoTelegram
): boolean {
  return prefs?.[categoria] !== false
}

/** Mantém só chaves conhecidas com valor booleano — o corpo do PATCH vem do cliente. */
export function sanitizarPreferencias(valor: unknown): PreferenciasNotificacaoTelegram {
  const prefs: PreferenciasNotificacaoTelegram = {}
  if (!valor || typeof valor !== 'object') return prefs
  for (const { id } of CATEGORIAS_NOTIFICACAO_TELEGRAM) {
    const v = (valor as Record<string, unknown>)[id]
    if (typeof v === 'boolean') prefs[id] = v
  }
  return prefs
}
