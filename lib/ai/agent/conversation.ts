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
/** Sem resumo, até aqui a conversa inteira cabe no prompt. */
const GATILHO_RESUMO = 18
/**
 * Quantas mensagens antigas ainda não resumidas podem ir no prompt junto com a
 * janela antes de o resumo ser refeito.
 */
const PASSO_RESUMO = 6
const PREFIXO_RESUMO = '[RESUMO'

/**
 * O resumo guarda quantas mensagens ele cobre: "[RESUMO n=31] texto". O formato
 * antigo ("[RESUMO] texto") não dizia — e, como nunca era refeito, numa conversa
 * longa as mensagens entre o fim do resumo e a janela recente sumiam do prompt.
 */
function lerResumo(conteudo: string): { cobertas: number; texto: string } {
  const m = conteudo.match(/^\[RESUMO(?:\s+n=(\d+))?\]\s*/)
  return { cobertas: m?.[1] ? Number(m[1]) : 0, texto: conteudo.slice(m?.[0].length ?? 0) }
}

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
  const ehPrimeiraMensagem = total === 0

  /** As últimas `n` mensagens (sem as de sistema), em ordem cronológica. */
  const ultimas = async (n: number) => {
    if (n <= 0) return []
    const { data } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .neq('role', 'system')
      .order('created_at', { ascending: false })
      .limit(n)
    return (data ?? []).reverse()
  }

  const { data: resumoExistente } = total > JANELA
    ? await supabase
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .eq('role', 'system')
      .ilike('content', `${PREFIXO_RESUMO}%`)
      .order('created_at', { ascending: false })
      .limit(1)
    : { data: null }

  const resumoAtual = resumoExistente?.[0]?.content ? lerResumo(resumoExistente[0].content) : null

  // Conversa curta: vai inteira.
  if (!resumoAtual && total <= GATILHO_RESUMO) {
    return { mensagens: await ultimas(total), ehPrimeiraMensagem }
  }

  // Resumo recente o bastante: ele + TUDO que veio depois dele. Nenhuma
  // mensagem fica sem cobertura.
  if (resumoAtual && total - resumoAtual.cobertas <= JANELA + PASSO_RESUMO) {
    return {
      mensagens: await ultimas(total - resumoAtual.cobertas),
      resumo: resumoExistente![0].content,
      ehPrimeiraMensagem,
    }
  }

  // Refaz o resumo de forma incremental: o anterior + as mensagens que ele
  // ainda não cobria, até o começo da janela recente.
  const { data: todas } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .neq('role', 'system')
    .order('created_at', { ascending: true })

  const lista = todas ?? []
  const cobertasAntes = resumoAtual?.cobertas ?? 0
  const fimDasAntigas = Math.max(0, lista.length - JANELA)
  const novas = lista.slice(cobertasAntes, fimDasAntigas)
  const mensagens = lista.slice(fimDasAntigas)

  const texto = novas.length > 0
    ? await resumirConversa(apiKey, novas, Math.min(deadlineMs, Date.now() + 12_000), resumoAtual?.texto)
    : null

  if (!texto) {
    // Sem resumo novo (falha ou timeout): manda o que der sem estourar o prompt.
    return {
      mensagens: lista.slice(Math.max(cobertasAntes, lista.length - (JANELA + PASSO_RESUMO))),
      resumo: resumoExistente?.[0]?.content,
      ehPrimeiraMensagem,
    }
  }

  const resumo = `${PREFIXO_RESUMO} n=${fimDasAntigas}] ${texto}`
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
