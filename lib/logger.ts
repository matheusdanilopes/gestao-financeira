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

/** Converts any value to a finite number, returning fallback (default 0) for NaN/Infinity/null/undefined */
export function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function formatBRL(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
