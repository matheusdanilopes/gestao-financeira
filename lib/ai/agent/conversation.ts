/**
 * Persistência da conversa (tabelas `conversations` e `messages`).
 *
 * Isolado da rota para que o handler HTTP cuide só de streaming e erros.
 * O resumo de histórico longo é gerado sob demanda e gravado como uma
 * mensagem `system` com prefixo [RESUMO], que passa a substituir as mensagens
 * antigas no prompt.
 */

import { resumirConversa } from './geminiClient'
import type { criarSupabaseServer } from '../../supabaseServer'

type Supabase = ReturnType<typeof criarSupabaseServer>

/** Mensagens recentes mantidas na íntegra no prompt. */
const JANELA = 12
/** A partir daqui vale a pena resumir o que ficou para trás. */
const GATILHO_RESUMO = 18
const PREFIXO_RESUMO = '[RESUMO]'

export interface ContextoConversa {
  mensagens: Array<{ role: string; content: string }>
  resumo?: string
  ehPrimeiraMensagem: boolean
}

/**
 * Devolve o id de uma conversa que comprovadamente pertence ao usuário —
 * validando a existente ou criando uma nova. Toda consulta posterior a
 * `messages` pode filtrar só por conversation_id porque a posse foi checada
 * aqui.
 */
export async function garantirConversa(
  supabase: Supabase,
  conversationId: string | null,
  userId: string
): Promise<string> {
  if (conversationId) {
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.id) return data.id
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(`Falha ao criar conversa: ${error?.message ?? 'desconhecido'}`)
  }
  return data.id
}

export async function carregarContexto(
  supabase: Supabase,
  apiKey: string,
  conversationId: string,
  deadlineMs: number
): Promise<ContextoConversa> {
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('role', 'system')

  const total = count ?? 0

  const { data: recentes } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: false })
    .limit(JANELA)

  const mensagens = (recentes ?? []).reverse()
  const ehPrimeiraMensagem = total === 0

  if (total <= JANELA) return { mensagens, ehPrimeiraMensagem }

  const { data: resumoExistente } = await supabase
    .from('messages')
    .select('content')
    .eq('conversation_id', conversationId)
    .eq('role', 'system')
    .ilike('content', `${PREFIXO_RESUMO}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  if (resumoExistente?.[0]?.content) {
    return { mensagens, resumo: resumoExistente[0].content, ehPrimeiraMensagem }
  }

  if (total <= GATILHO_RESUMO) return { mensagens, ehPrimeiraMensagem }

  const { data: todas } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: true })

  const antigas = (todas ?? []).slice(0, Math.max(0, (todas ?? []).length - JANELA))
  if (antigas.length === 0) return { mensagens, ehPrimeiraMensagem }

  const texto = await resumirConversa(apiKey, antigas, Math.min(deadlineMs, Date.now() + 12_000))
  if (!texto) return { mensagens, ehPrimeiraMensagem }

  const resumo = `${PREFIXO_RESUMO} ${texto}`
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'system',
    content: resumo,
  })

  return { mensagens, resumo, ehPrimeiraMensagem }
}

export async function salvarMensagem(
  supabase: Supabase,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role,
    content,
  })
}
