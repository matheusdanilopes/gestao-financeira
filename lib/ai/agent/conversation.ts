/**
 * Persistência da conversa (tabelas `conversations` e `messages`).
 *
 * Isolado da rota para que o handler HTTP cuide só de streaming e erros.
 * O resumo de histórico longo é gerado sob demanda e gravado como uma
 * mensagem `system` com prefixo [RESUMO], que passa a substituir as mensagens
 * antigas no prompt.
 */

import { resumirConversa } from './geminiClient'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanalConversa } from './interlocutor'

// Sessão do usuário (app) ou service role (webhook do Telegram).
type Supabase = SupabaseClient

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
  /** Mensagens (sem as de sistema) gravadas na conversa. */
  total: number
}

/** Máximo de mensagens que o cliente pode mandar como histórico de reserva. */
export const LIMITE_HISTORICO_CLIENTE = JANELA + PASSO_RESUMO
const LIMITE_CONTEUDO_CLIENTE = 4_000

/**
 * O que está na tela do app vale como histórico quando o banco tem MENOS
 * mensagens que ela — uma gravação que falhou não pode apagar a memória da
 * conversa. Só papéis user/assistant, conteúdo truncado; operações de escrita
 * continuam presas à tabela chat_operacoes, então um histórico forjado não
 * confirma nada.
 */
export function historicoComReserva(
  contexto: ContextoConversa,
  cliente: unknown,
  pergunta: string
): Array<{ role: string; content: string }> {
  if (!Array.isArray(cliente)) return contexto.mensagens
  const limpo = cliente
    .filter((m): m is { role: string; content: string } =>
      !!m && typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.trim() !== '')
    .map(m => ({ role: m.role, content: m.content.slice(0, LIMITE_CONTEUDO_CLIENTE) }))
  // Num reenvio a pergunta já está na tela: ela vai como pergunta, não como histórico.
  if (limpo.length > 0 && limpo[limpo.length - 1].role === 'user' && limpo[limpo.length - 1].content === pergunta) limpo.pop()
  const recentes = limpo.slice(-LIMITE_HISTORICO_CLIENTE)
  if (recentes.length <= contexto.total) return contexto.mensagens
  console.warn(`[chat] histórico do banco incompleto (${contexto.total} gravadas, ${limpo.length} na tela) — usando o da tela`)
  return recentes
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
    return { mensagens: await ultimas(total), ehPrimeiraMensagem, total }
  }

  // Resumo recente o bastante: ele + TUDO que veio depois dele. Nenhuma
  // mensagem fica sem cobertura.
  if (resumoAtual && total - resumoAtual.cobertas <= JANELA + PASSO_RESUMO) {
    return {
      mensagens: await ultimas(total - resumoAtual.cobertas),
      resumo: resumoExistente![0].content,
      ehPrimeiraMensagem,
      total,
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
      total,
    }
  }

  const resumo = `${PREFIXO_RESUMO} n=${fimDasAntigas}] ${texto}`
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'system',
    content: resumo,
  })

  return { mensagens, resumo, ehPrimeiraMensagem, total }
}

/** Uma ferramenta usada para produzir a resposta — a trilha que fica gravada com ela. */
export interface FerramentaUsada {
  nome: string
  rotulo: string
  args?: Record<string, unknown>
}

/** Tentativas de gravação além da primeira (falha de rede, sem resposta HTTP). */
const RETENTATIVAS_GRAVACAO = 2

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Coluna nova ainda não criada no banco (código do app à frente da migration):
 * a mensagem é gravada sem ela em vez de se perder.
 */
const colunaAusente = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST204' || e.code === '42703' || /ferramentas/.test(e.message ?? '')

/**
 * Grava uma mensagem no histórico e devolve o id — ou null se a gravação
 * falhou (o erro vai para o log). O Telegram usa o id para só apagar do chat
 * o que comprovadamente ficou guardado aqui.
 *
 * O id é gerado aqui e a gravação é um upsert nele: assim dá para repetir a
 * tentativa depois de uma falha de rede sem duplicar a mensagem. O cliente do
 * Supabase só repete sozinho GET/HEAD — um POST que perdia a conexão sumia, e
 * a conversa seguinte chegava ao modelo sem as mensagens anteriores (a IA
 * "esquecia" o que tinha acabado de responder).
 */
export async function salvarMensagem(
  supabase: Supabase,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  canal: CanalConversa = 'app',
  ferramentas?: FerramentaUsada[]
): Promise<string | null> {
  const id = crypto.randomUUID()
  let linha: Record<string, unknown> = { id, conversation_id: conversationId, role, content, canal }
  if (ferramentas && ferramentas.length > 0) linha.ferramentas = ferramentas

  for (let tentativa = 0; ; tentativa++) {
    const { error } = await supabase
      .from('messages')
      .upsert(linha, { onConflict: 'id', ignoreDuplicates: true })
    if (!error) return id

    if ('ferramentas' in linha && colunaAusente(error)) {
      const { ferramentas: _, ...semFerramentas } = linha
      linha = semFerramentas
      continue
    }
    // Com resposta do PostgREST (code preenchido) o erro é de dado ou de
    // permissão: repetir não muda nada. Sem code, foi a conexão.
    if (error.code || tentativa >= RETENTATIVAS_GRAVACAO) {
      console.error('[chat] salvar mensagem:', error.message, error.details ?? '', error.hint ?? '')
      return null
    }
    await esperar(400 * (tentativa + 1))
  }
}
