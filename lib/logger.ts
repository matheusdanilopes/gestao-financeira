import { supabase } from './supabaseClient'
import { notificar } from './notificacoes'

export type AcaoLog =
  | 'inserir'
  | 'editar'
  | 'excluir'
  | 'pagar'
  | 'receber'
  | 'aporte'
  | 'importar'

export function log(
  acao: AcaoLog,
  tabela: string,
  descricao: string,
  valor?: number,
  valorAnterior?: number
) {
  void (async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const usuario = user?.email ?? null

    const { error } = await supabase.from('activity_logs').insert([{
      acao,
      tabela,
      descricao,
      valor: valor ?? null,
      valor_anterior: valorAnterior ?? null,
      usuario,
    }])
    if (error) console.error('[log] Falha ao registrar atividade:', error)

    if (usuario) {
      notificar(acao, descricao, valor, usuario)
    }
  })()
}

export function numericOnly(value: string): string {
  return value.replace(/[^0-9,.]/g, '')
}
