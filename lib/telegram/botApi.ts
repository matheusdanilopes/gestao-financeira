/**
 * Cliente mínimo da Bot API do Telegram.
 *
 * Variável de ambiente:
 *   TELEGRAM_BOT_TOKEN  token entregue pelo @BotFather ao criar o bot
 *
 * O token só existe na variável de ambiente e na URL das chamadas: toda
 * mensagem de erro passa por `semToken` antes de ir para log ou banco.
 *
 * O resto é derivado: o segredo do webhook sai do próprio token (não há uma
 * segunda variável para esquecer) e o webhook é registrado pelo app ao abrir
 * a tela de Configurações (ver garantirWebhook).
 */

import { createHash, timingSafeEqual } from 'crypto'

const token = () => process.env.TELEGRAM_BOT_TOKEN ?? ''
const api = (metodo: string) => `https://api.telegram.org/bot${token()}/${metodo}`

/** Limite do Telegram é 4096 caracteres por mensagem; sobra folga para as tags HTML. */
export const LIMITE_MENSAGEM = 3500
/** Bots só baixam arquivos de até 20 MB pela Bot API. */
const LIMITE_AUDIO_BYTES = 19 * 1024 * 1024

export function telegramConfigurado(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN)
}

/**
 * Segredo enviado pelo Telegram no cabeçalho X-Telegram-Bot-Api-Secret-Token
 * de cada update. Sem ele, qualquer um que descobrisse a URL do webhook
 * poderia se passar por um chat vinculado e ler as finanças do casal.
 */
export function segredoWebhook(): string {
  return createHash('sha256').update(`telegram-webhook:${token()}`).digest('hex')
}

export function segredoValido(cabecalho: string | null): boolean {
  if (!telegramConfigurado() || !cabecalho) return false
  const esperado = Buffer.from(segredoWebhook())
  const recebido = Buffer.from(cabecalho)
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

interface RespostaApi<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

/** Remove o token de qualquer texto que vá para log ou para o banco. */
function semToken(texto: string): string {
  const t = token()
  return t ? texto.split(t).join('***') : texto
}

export class TelegramError extends Error {
  constructor(
    metodo: string,
    readonly codigo: number | undefined,
    readonly descricao: string | undefined,
    /** Segundos pedidos pelo Telegram num 429 (limite de requisições). */
    readonly retryAfter?: number
  ) {
    super(semToken(`Telegram ${metodo}: ${codigo ?? '?'} ${descricao ?? 'sem descrição'}`))
    this.name = 'TelegramError'
  }
}

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Tentativas por chamada quando a falha é temporária (429, 5xx, rede). */
const TENTATIVAS_PADRAO = 4
/**
 * Espera máxima dentro de uma mesma chamada. Um 429 pedindo mais que isso é
 * devolvido a quem chamou — a fila de exclusão reagenda em vez de segurar a
 * função parada.
 */
const ESPERA_MAX_MS = 20_000
const TIMEOUT_CHAMADA_MS = 20_000

/** 1 s, 2 s, 4 s, 8 s… com um pouco de aleatoriedade para não sincronizar reenvios. */
function espera(tentativa: number): number {
  return Math.min(1_000 * 2 ** (tentativa - 1), 8_000) + Math.floor(Math.random() * 250)
}

/**
 * Chama a Bot API. Limite de requisições (429) respeita o retry_after do
 * Telegram; erro 5xx e falha de rede tentam de novo com espera progressiva.
 * Erros 4xx (fora o 429) são definitivos e sobem na hora.
 */
async function chamar<T>(
  metodo: string,
  corpo?: Record<string, unknown>,
  tentativas = TENTATIVAS_PADRAO
): Promise<T> {
  for (let n = 1; ; n++) {
    let res: Response
    try {
      res = await fetch(api(metodo), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo ?? {}),
        signal: AbortSignal.timeout(TIMEOUT_CHAMADA_MS),
      })
    } catch (err) {
      if (n >= tentativas) {
        throw new TelegramError(metodo, undefined, `falha de rede: ${err instanceof Error ? err.message : String(err)}`)
      }
      await esperar(espera(n))
      continue
    }

    const json = (await res.json().catch(() => ({ ok: false }))) as RespostaApi<T>
    if (json.ok) return json.result as T

    const codigo = json.error_code ?? res.status
    const retryAfter = json.parameters?.retry_after
    const erro = new TelegramError(metodo, codigo, json.description, retryAfter)
    const temporario = codigo === 429 || codigo >= 500
    if (!temporario || n >= tentativas) throw erro

    const ms = codigo === 429 && retryAfter ? retryAfter * 1_000 + 250 : espera(n)
    if (ms > ESPERA_MAX_MS) throw erro
    await esperar(ms)
  }
}

/** Botão sob a mensagem: dispara um callback para o webhook ou abre um link. */
export type BotaoInline =
  | { text: string; callback_data: string }
  | { text: string; url: string }

export interface MensagemEnviada {
  message_id: number
  /** Unix time (segundos) em que o Telegram registrou a mensagem. */
  date: number
}

/**
 * Envia texto já em HTML do Telegram. Se o Telegram recusar a marcação
 * ("can't parse entities"), manda o mesmo conteúdo como texto puro — uma
 * resposta sem negrito é melhor que nenhuma resposta.
 */
export async function enviarMensagem(
  chatId: number,
  html: string,
  textoPuro: string,
  botoes?: BotaoInline[][]
): Promise<MensagemEnviada> {
  const extras = botoes ? { reply_markup: { inline_keyboard: botoes } } : {}
  try {
    return await chamar<MensagemEnviada>('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extras,
    })
  } catch (err) {
    if (!(err instanceof TelegramError) || err.codigo !== 400) throw err
    return await chamar<MensagemEnviada>('sendMessage', { chat_id: chatId, text: textoPuro, ...extras })
  }
}

export type ResultadoExclusao =
  | { tipo: 'apagada' }
  /** Já não estava no chat (o usuário apagou antes, ou outra execução chegou primeiro). */
  | { tipo: 'inexistente' }
  /** O Telegram recusou de vez — não adianta tentar de novo. */
  | { tipo: 'definitivo'; naoApagavel: boolean; motivo: string }
  /** Limite de requisições, erro do servidor ou rede: tentar mais tarde. */
  | { tipo: 'temporario'; motivo: string; retryAfterS?: number }

/** Apaga uma mensagem do chat. Nunca lança: classifica o resultado. */
export async function apagarMensagem(chatId: number, messageId: number): Promise<ResultadoExclusao> {
  try {
    await chamar<boolean>('deleteMessage', { chat_id: chatId, message_id: messageId }, 3)
    return { tipo: 'apagada' }
  } catch (err) {
    if (!(err instanceof TelegramError)) {
      return { tipo: 'temporario', motivo: semToken(err instanceof Error ? err.message : String(err)) }
    }
    const descricao = (err.descricao ?? '').toLowerCase()
    if (err.codigo === 400 && descricao.includes('message to delete not found')) return { tipo: 'inexistente' }
    if (err.codigo === 400) {
      return { tipo: 'definitivo', naoApagavel: descricao.includes("can't be deleted"), motivo: err.message }
    }
    // 403 (bot bloqueado), 429, 5xx, rede: pode passar — reagenda.
    return { tipo: 'temporario', motivo: err.message, retryAfterS: err.retryAfter }
  }
}

/** "Digitando…" — dura ~5 s no Telegram; quem chama renova enquanto trabalha. */
export async function mostrarDigitando(chatId: number): Promise<void> {
  try {
    await chamar('sendChatAction', { chat_id: chatId, action: 'typing' }, 1)
  } catch {
    /* indicador é opcional */
  }
}

/** Fecha o "carregando" do botão tocado e, opcionalmente, mostra um aviso curto. */
export async function responderCallback(callbackId: string, aviso?: string): Promise<void> {
  try {
    await chamar('answerCallbackQuery', { callback_query_id: callbackId, ...(aviso ? { text: aviso } : {}) }, 1)
  } catch {
    /* só visual */
  }
}

/** Tira os botões de uma mensagem já respondida — um "Confirmar" não pode ser tocado duas vezes. */
export async function removerBotoes(chatId: number, messageId: number): Promise<void> {
  try {
    await chamar('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    })
  } catch {
    /* mensagem antiga ou já editada */
  }
}

/** Baixa um áudio de voz e devolve em base64 para a transcrição. */
export async function baixarArquivo(
  fileId: string,
  mimeTypePadrao = 'audio/ogg'
): Promise<{ base64: string; mimeType: string } | null> {
  const info = await chamar<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId })
  if (!info.file_path) return null
  if (info.file_size && info.file_size > LIMITE_AUDIO_BYTES) return null

  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${info.file_path}`)
  if (!res.ok) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > LIMITE_AUDIO_BYTES) return null

  // Voz do Telegram é OGG/Opus, que o Gemini aceita como "audio/ogg".
  const mimeType = (res.headers.get('content-type') ?? '').startsWith('audio/')
    ? (res.headers.get('content-type') as string).split(';')[0].trim()
    : mimeTypePadrao.split(';')[0].trim()
  return { base64: bytes.toString('base64'), mimeType }
}

// ─── Configuração do bot ─────────────────────────────────────────────────────

let usuarioBotCache: string | null = null

/** @usuario do bot (sem @), para montar o link t.me. */
export async function usuarioDoBot(): Promise<string | null> {
  if (usuarioBotCache) return usuarioBotCache
  try {
    const eu = await chamar<{ username?: string }>('getMe')
    usuarioBotCache = eu.username ?? null
    return usuarioBotCache
  } catch {
    return null
  }
}

/** URL em que o webhook é registrado nesta instância, guardada para não chamar a API a cada tela aberta. */
let webhookGarantido: string | null = null

/**
 * Registra o webhook (e o menu de comandos) se o Telegram ainda não aponta
 * para esta URL. Chamado ao abrir a tela de Configurações — assim basta
 * cadastrar o token na Vercel, sem nenhum passo manual de setWebhook.
 */
export async function garantirWebhook(url: string): Promise<void> {
  if (webhookGarantido === url) return

  const info = await chamar<{ url?: string }>('getWebhookInfo')
  if (info.url !== url) {
    await chamar('setWebhook', {
      url,
      secret_token: segredoWebhook(),
      allowed_updates: ['message', 'callback_query'],
      max_connections: 10,
    })
    await chamar('setMyCommands', {
      commands: [
        { command: 'ajuda', description: 'O que posso perguntar' },
        { command: 'nova', description: 'Começar uma conversa nova' },
        { command: 'desvincular', description: 'Desconectar este Telegram do app' },
      ],
    }).catch(() => undefined)
  }
  webhookGarantido = url
}
