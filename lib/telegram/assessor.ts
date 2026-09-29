/**
 * Processa um update do Telegram e responde como assessor financeiro, com os
 * dados do usuário dono do chat vinculado.
 *
 * Fluxo: dedupe → (/start CODIGO → vínculo) → vínculo existente → (áudio →
 * transcrição) → comandos → turno do agente (o mesmo do chat do app) →
 * resposta em HTML do Telegram, com botões Confirmar/Cancelar quando o turno
 * deixou uma operação pendente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { garantirConversa } from '../ai/agent/conversation'
import { executarTurno, descreverErro } from '../ai/agent/turno'
import { criarInterlocutor, responsavelDoEmail } from '../ai/agent/interlocutor'
import { transcreverAudio } from '../ai/agent/geminiClient'
import { CONVERSA_OCIOSA_MS, EXEMPLOS_PERGUNTA, identificarComando } from '../ai/agent/comandos'
import {
  enviarMensagem,
  mostrarDigitando,
  responderCallback,
  removerBotoes,
  baixarArquivo,
  type BotaoInline,
} from './botApi'
import { markdownParaHtmlTelegram, markdownParaTextoPuro, dividirMarkdown } from './formatacao'

// ─── Formato (parcial) dos updates da Bot API ────────────────────────────────

interface Usuario {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}

interface Chat {
  id: number
  type: string
}

interface Arquivo {
  file_id: string
  mime_type?: string
  file_size?: number
}

export interface MensagemTelegram {
  message_id: number
  from?: Usuario
  chat: Chat
  text?: string
  voice?: Arquivo
  audio?: Arquivo
}

export interface UpdateTelegram {
  update_id: number
  message?: MensagemTelegram
  callback_query?: {
    id: string
    from: Usuario
    message?: { message_id: number; chat: Chat }
    data?: string
  }
}

interface Vinculo {
  id: string
  user_id: string
  email: string | null
  conversation_id: string | null
  ultima_interacao_em: string | null
}

const LIMITE_PERGUNTA = 2_000
/** O "digitando…" do Telegram dura ~5 s. */
const RENOVAR_DIGITANDO_MS = 4_000
const RETENCAO_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000

const CALLBACK_CONFIRMAR = 'op:sim'
const CALLBACK_CANCELAR = 'op:nao'
const BOTOES_OPERACAO: BotaoInline[][] = [[
  { text: '✅ Confirmar', callback_data: CALLBACK_CONFIRMAR },
  { text: '❌ Cancelar', callback_data: CALLBACK_CANCELAR },
]]

const PASSO_A_PASSO_VINCULO =
  'Para conectar, abra o app → **Configurações** → aba **Conta** → **Assessor no Telegram** → ' +
  '**Conectar Telegram**. O botão abre esta conversa já com o código.'

function ajuda(nome: string | null): string {
  return [
    `Oi${nome ? `, ${nome}` : ''}! Sou seu assessor financeiro 🤝 Pode me perguntar por texto ou áudio, por exemplo:`,
    ...EXEMPLOS_PERGUNTA.map(e => `• ${e}`),
    '',
    'Quando falar na primeira pessoa ("eu", "meu"), respondo com os **seus** dados. Antes de lançar qualquer coisa, eu mostro o resumo e você toca em **Confirmar** ou **Cancelar**.',
    '',
    'Comandos: /nova (começa um assunto do zero) · /desvincular (desconecta este Telegram) · /ajuda',
  ].join('\n')
}

async function responder(chatId: number, markdown: string, botoes?: BotaoInline[][]): Promise<void> {
  const partes = dividirMarkdown(markdown)
  for (let i = 0; i < partes.length; i++) {
    // Os botões vão só na última parte, junto do pedido de confirmação.
    const ultima = i === partes.length - 1
    await enviarMensagem(
      chatId,
      markdownParaHtmlTelegram(partes[i]),
      markdownParaTextoPuro(partes[i]),
      ultima ? botoes : undefined
    )
  }
}

/** true se o update é novo; false se já foi processado (reentrega do Telegram). */
async function registrarRecebimento(admin: SupabaseClient, updateId: number): Promise<boolean> {
  const { error } = await admin.from('telegram_updates_processados').insert({ update_id: updateId })
  if (!error) return true
  if (error.code === '23505') return false
  // Sem a tabela não há dedupe, mas responder é melhor que ficar mudo.
  console.error('[telegram] dedupe:', error.message)
  return true
}

async function buscarVinculo(admin: SupabaseClient, chatId: number): Promise<Vinculo | null> {
  const { data } = await admin
    .from('telegram_vinculos')
    .select('id, user_id, email, conversation_id, ultima_interacao_em')
    .eq('chat_id', chatId)
    .maybeSingle<Vinculo>()
  return data ?? null
}

async function vincular(admin: SupabaseClient, chatId: number, nome: string | null, codigo: string): Promise<string> {
  const { data } = await admin
    .from('telegram_vinculos')
    .select('id, email, codigo_expira_em')
    .eq('codigo', codigo)
    .maybeSingle()

  if (!data || !data.codigo_expira_em || new Date(data.codigo_expira_em).getTime() < Date.now()) {
    return `Esse link de conexão é inválido ou já expirou. Gere um novo no app e toque nele de novo.\n\n${PASSO_A_PASSO_VINCULO}`
  }

  // Um chat só pode estar ligado a uma conta: se estava em outra, sai de lá.
  await admin
    .from('telegram_vinculos')
    .update({ chat_id: null, conversation_id: null, telegram_nome: null })
    .eq('chat_id', chatId)
    .neq('id', data.id)

  const { error } = await admin
    .from('telegram_vinculos')
    .update({
      chat_id: chatId,
      telegram_nome: nome,
      codigo: null,
      codigo_expira_em: null,
      vinculado_em: new Date().toISOString(),
      conversation_id: null,
      ultima_interacao_em: null,
    })
    .eq('id', data.id)

  if (error) {
    console.error('[telegram] vincular:', error.message)
    return 'Não consegui concluir a conexão agora. Toque no link do app de novo em instantes.'
  }

  return `✅ Pronto! Este Telegram está conectado à sua conta no app.\n\n${ajuda(responsavelDoEmail(data.email))}`
}

/** Conversa atual do chat — reaproveita a recente ou abre outra. */
async function conversaDoVinculo(admin: SupabaseClient, v: Vinculo): Promise<string> {
  const recente =
    v.conversation_id &&
    v.ultima_interacao_em &&
    Date.now() - new Date(v.ultima_interacao_em).getTime() < CONVERSA_OCIOSA_MS

  // garantirConversa valida que a conversa ainda existe e é do usuário
  // (ela pode ter sido apagada pelo histórico do app); se não, cria outra.
  const conversationId = await garantirConversa(admin, recente ? v.conversation_id : null, v.user_id)

  await admin
    .from('telegram_vinculos')
    .update({ conversation_id: conversationId, ultima_interacao_em: new Date().toISOString() })
    .eq('id', v.id)

  return conversationId
}

/**
 * true se o turno deixou uma operação aguardando confirmação — é o sinal para
 * mostrar os botões. Olhar a tabela (e não o texto) evita botão numa proposta
 * que falhou ou numa resposta que só menciona "confirmar".
 */
async function temPropostaNova(admin: SupabaseClient, conversationId: string, desde: number): Promise<boolean> {
  // Folga para diferença de relógio entre a função e o banco.
  const limite = new Date(desde - 5_000).toISOString()
  const { data } = await admin
    .from('chat_operacoes')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('status', 'pendente')
    .gte('created_at', limite)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/** Pergunta de um chat vinculado: comandos ou turno do agente. */
async function atender(
  admin: SupabaseClient,
  chatId: number,
  vinculo: Vinculo,
  texto: string,
  deadlineMs: number,
  transcricao: string | null
): Promise<void> {
  const interlocutor = criarInterlocutor(vinculo.email, 'telegram')

  const comando = identificarComando(texto)
  if (comando === 'ajuda') {
    await responder(chatId, ajuda(interlocutor.nome))
    return
  }
  if (comando === 'nova') {
    await admin.from('telegram_vinculos').update({ conversation_id: null }).eq('id', vinculo.id)
    await responder(chatId, 'Certo, começamos uma conversa nova. Em que posso ajudar? 🙂')
    return
  }
  if (comando === 'desvincular') {
    await admin
      .from('telegram_vinculos')
      .update({ chat_id: null, conversation_id: null, vinculado_em: null, telegram_nome: null })
      .eq('id', vinculo.id)
    await responder(chatId, 'Telegram desconectado. Não vou mais responder sobre suas finanças por aqui. Para voltar, use o botão **Conectar Telegram** no app.')
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    await responder(chatId, 'A IA do app não está configurada no servidor (falta a GEMINI_API_KEY).')
    return
  }

  const conversationId = await conversaDoVinculo(admin, vinculo)
  const inicio = Date.now()

  let resposta = ''
  try {
    for await (const evento of executarTurno({
      apiKey,
      supabase: admin,
      userId: vinculo.user_id,
      interlocutor,
      conversationId,
      pergunta: texto.slice(0, LIMITE_PERGUNTA),
      deadlineMs,
    })) {
      if (evento.type === 'done') resposta = evento.texto
    }
  } catch (err) {
    console.error('[telegram] turno:', err instanceof Error ? err.message : err)
    resposta = descreverErro(err).mensagem
  }

  if (transcricao) {
    // Ecoa o que foi entendido: num "paguei 180 de luz" por voz, é o que
    // permite perceber um erro de transcrição antes de confirmar.
    const eco = transcricao.length > 300 ? `${transcricao.slice(0, 300)}…` : transcricao
    resposta = `🎤 _"${eco}"_\n\n${resposta}`
  }

  const botoes = (await temPropostaNova(admin, conversationId, inicio)) ? BOTOES_OPERACAO : undefined
  await responder(chatId, resposta || 'Não consegui formular a resposta agora. Pode reformular a pergunta?', botoes)
}

/** "/start ABCDEFGH" → "ABCDEFGH" (o payload do link t.me/bot?start=...). */
function codigoDoStart(texto: string): string | null | undefined {
  const m = texto.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i)
  if (!m) return undefined // não é /start
  return m[1] ? m[1].toUpperCase() : null // /start sem código
}

async function comDigitando(chatId: number, trabalho: () => Promise<void>): Promise<void> {
  await mostrarDigitando(chatId)
  const t = setInterval(() => { void mostrarDigitando(chatId) }, RENOVAR_DIGITANDO_MS)
  try {
    await trabalho()
  } finally {
    clearInterval(t)
  }
}

async function processarCallback(
  admin: SupabaseClient,
  cb: NonNullable<UpdateTelegram['callback_query']>,
  deadlineMs: number
): Promise<void> {
  const chat = cb.message?.chat
  if (!chat || chat.type !== 'private') {
    await responderCallback(cb.id)
    return
  }

  const vinculo = await buscarVinculo(admin, chat.id)
  if (!vinculo || (cb.data !== CALLBACK_CONFIRMAR && cb.data !== CALLBACK_CANCELAR)) {
    await responderCallback(cb.id, vinculo ? undefined : 'Este Telegram não está conectado ao app.')
    return
  }

  const confirmar = cb.data === CALLBACK_CONFIRMAR
  await responderCallback(cb.id, confirmar ? 'Confirmando…' : 'Cancelando…')
  if (cb.message) await removerBotoes(chat.id, cb.message.message_id)

  // O toque vira uma mensagem do usuário: a confirmação continua passando
  // pelo agente, que só executa a operação já gravada como pendente.
  const texto = confirmar ? 'Sim, pode confirmar.' : 'Não, pode cancelar.'
  await comDigitando(chat.id, () => atender(admin, chat.id, vinculo, texto, deadlineMs, null))
}

export async function processarUpdate(
  admin: SupabaseClient,
  update: UpdateTelegram,
  deadlineMs: number
): Promise<void> {
  if (typeof update.update_id !== 'number') return
  if (!(await registrarRecebimento(admin, update.update_id))) return

  if (update.callback_query) {
    await processarCallback(admin, update.callback_query, deadlineMs)
    return
  }

  const msg = update.message
  // Só conversas privadas: num grupo, "eu" não identifica ninguém.
  if (!msg || msg.chat.type !== 'private' || msg.from?.is_bot) return
  const chatId = msg.chat.id
  const nomeTelegram = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name ?? null

  await comDigitando(chatId, async () => {
    const texto = msg.text?.trim() ?? ''

    const codigo = codigoDoStart(texto)
    if (codigo) {
      await responder(chatId, await vincular(admin, chatId, nomeTelegram, codigo))
      return
    }

    const vinculo = await buscarVinculo(admin, chatId)
    if (!vinculo) {
      await responder(
        chatId,
        `Olá! 👋 Sou o assessor do app de gestão financeira, mas este Telegram ainda não está conectado a uma conta.\n\n${PASSO_A_PASSO_VINCULO}`
      )
      return
    }

    if (codigo === null) {
      // /start sem código num chat já vinculado: só reapresenta.
      await responder(chatId, ajuda(responsavelDoEmail(vinculo.email)))
      return
    }

    const audio = msg.voice ?? msg.audio
    if (audio) {
      const apiKey = process.env.GEMINI_API_KEY
      const midia = apiKey ? await baixarArquivo(audio.file_id, audio.mime_type).catch(() => null) : null
      const transcricao = midia && apiKey
        ? await transcreverAudio(apiKey, midia.base64, midia.mimeType, Math.min(deadlineMs, Date.now() + 25_000)).catch(() => null)
        : null
      if (!transcricao) {
        await responder(chatId, 'Não consegui entender o áudio 😕 Pode repetir ou mandar por texto?')
        return
      }
      await atender(admin, chatId, vinculo, transcricao, deadlineMs, transcricao)
      return
    }

    if (!texto) {
      await responder(chatId, 'Por enquanto eu entendo mensagens de texto e de áudio. Pode me mandar sua pergunta assim?')
      return
    }

    await atender(admin, chatId, vinculo, texto, deadlineMs, null)
  })
}

/** Remove update_ids antigos da tabela de dedupe — o Telegram não reentrega depois de dias. */
export async function limparDedupe(admin: SupabaseClient): Promise<void> {
  const limite = new Date(Date.now() - RETENCAO_DEDUPE_MS).toISOString()
  await admin.from('telegram_updates_processados').delete().lt('recebido_em', limite)
}
