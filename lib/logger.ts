import { supabase } from './supabaseClient'

export type AcaoLog =
  | 'inserir'
  | 'editar'
  | 'excluir'
  | 'pagar'
  | 'receber'
  | 'aporte'
  | 'importar'

/**
 * Registra uma ação do usuário na tabela activity_logs.
 * Fire-and-forget — nunca lança exceção para não bloquear a UI.
 */
export function log(
  acao: AcaoLog,
  tabela: string,
  descricao: string,
  valor?: number
) {
  void (async () => {
    await supabase.from('activity_logs').insert([{
      acao,
      tabela,
      descricao,
      valor: valor ?? null,
    }])
  })()
}

/**
 * Remove caracteres não numéricos de um campo monetário/percentual.
 * Permite: dígitos, vírgula e ponto.
 * Use no onChange de inputs de valor.
 */
export function numericOnly(value: string): string {
  return value.replace(/[^0-9,.]/g, '')
}
