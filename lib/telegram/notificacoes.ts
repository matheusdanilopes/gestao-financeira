/**
 * Avisos do app pelo Telegram — o mesmo que sai por push, entregue no chat
 * de quem conectou o bot (Configurações → Conta → Assessor no Telegram).
 *
 * Só para código de servidor: lê os vínculos de todos com a service role
 * (a RLS de telegram_vinculos só mostra a própria linha a cada um). Nunca
 * lança: uma falha no Telegram não pode derrubar a importação, o cron ou a
 * gravação que originou o aviso.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { criarSupabaseAdmin } from '../supabaseAdmin'
import { responsavelDoEmail } from '../ai/agent/interlocutor'
import { enviarMensagem, telegramConfigurado, TelegramError, type BotaoInline } from './botApi'
import { markdownParaHtmlTelegram, markdownParaTextoPuro, dividirMarkdown } from './formatacao'
import {
  categoriaAtiva,
  type CategoriaNotificacaoTelegram,
  type PreferenciasNotificacaoTelegram,
} from './categoriasNotificacao'

export interface DestinatarioTelegram {
  chatId: number
  email: string | null
  /** Responsável correspondente nos dados ("Matheus", "Jeniffer"), ou null. */
  responsavel: string | null
}

export interface MensagemTelegram {
  /** Primeira linha, em negrito. */
  titulo: string
  /** Markdown enxuto (negrito, listas) — convertido para o HTML do Telegram. */
  corpo?: string
  /** Tela do app aberta pelo botão sob a mensagem (ex.: "/contas"). */
  caminho?: string
}

/** Recebe cada pessoa conectada e devolve a mensagem dela — ou null para não avisar essa pessoa. */
export type MontarMensagem = (d: DestinatarioTelegram) => MensagemTelegram | null

interface LinhaVinculo {
  chat_id: number
  email: string | null
  notificacoes?: PreferenciasNotificacaoTelegram | null
}

const LIMITE_URL_BOTAO = 1024

/**
 * Endereço público do app, para o botão "Abrir no app". O Telegram recusa a
 * mensagem inteira se o link do botão for inválido (ex.: localhost), então
 * sem um https:// público a mensagem vai sem botão.
 */
function urlDoApp(caminho: string): string | null {
  const producao = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const base = process.env.NEXT_PUBLIC_APP_URL || (producao ? `https://${producao}` : '')
  if (!/^https:\/\//.test(base) || /\/\/(localhost|127\.0\.0\.1)/.test(base)) return null
  try {
    const url = new URL(caminho, base)
    // Deep links com muitos ids (ex.: highlight de várias compras) passam do
    // que o Telegram aceita num botão; a tela sem filtro ainda serve.
    if (url.toString().length > LIMITE_URL_BOTAO) url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

function colunaAusente(erro: { code?: string; message?: string }): boolean {
  return erro.code === '42703' || erro.code === 'PGRST204' || /notificacoes/.test(erro.message ?? '')
}

async function carregarVinculos(admin: SupabaseClient): Promise<LinhaVinculo[]> {
  const { data, error } = await admin
    .from('telegram_vinculos')
    .select('chat_id, email, notificacoes')
    .not('chat_id', 'is', null)
  if (!error) return (data ?? []) as LinhaVinculo[]

  // Sem migration_telegram_notificacoes.sql não há preferências: todos os tipos ligados.
  if (colunaAusente(error)) {
    const semPrefs = await admin.from('telegram_vinculos').select('chat_id, email').not('chat_id', 'is', null)
    if (!semPrefs.error) return (semPrefs.data ?? []) as LinhaVinculo[]
    console.error('[telegram] notificações — vínculos:', semPrefs.error.message)
    return []
  }
  console.error('[telegram] notificações — vínculos:', error.message)
  return []
}

/** Envia um aviso a um chat específico. Lança em caso de falha (ex.: TelegramError 403). */
export async function enviarAvisoTelegram(chatId: number, msg: MensagemTelegram): Promise<void> {
  const markdown = [`**${msg.titulo}**`, msg.corpo?.trim()].filter(Boolean).join('\n')
  const link = msg.caminho ? urlDoApp(msg.caminho) : null
  const botoes: BotaoInline[][] | undefined = link ? [[{ text: 'Abrir no app', url: link }]] : undefined

  const partes = dividirMarkdown(markdown)
  for (let i = 0; i < partes.length; i++) {
    await enviarMensagem(
      chatId,
      markdownParaHtmlTelegram(partes[i]),
      markdownParaTextoPuro(partes[i]),
      i === partes.length - 1 ? botoes : undefined
    )
  }
}

/**
 * Envia um aviso da `categoria` a cada pessoa com o Telegram conectado que
 * não desligou esse tipo. Devolve quantas mensagens saíram.
 */
export async function notificarTelegram(
  categoria: CategoriaNotificacaoTelegram,
  montar: MontarMensagem
): Promise<number> {
  if (!telegramConfigurado()) return 0
  const admin = criarSupabaseAdmin()
  if (!admin) return 0

  try {
    const vinculos = await carregarVinculos(admin)
    const envios = vinculos
      .filter(v => categoriaAtiva(v.notificacoes, categoria))
      .map(v => {
        const destinatario: DestinatarioTelegram = {
          chatId: Number(v.chat_id),
          email: v.email,
          responsavel: responsavelDoEmail(v.email),
        }
        return { destinatario, msg: montar(destinatario) }
      })
      .filter((e): e is { destinatario: DestinatarioTelegram; msg: MensagemTelegram } => e.msg !== null)

    const resultados = await Promise.allSettled(envios.map(e => enviarAvisoTelegram(e.destinatario.chatId, e.msg)))

    let enviados = 0
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        enviados++
        return
      }
      // 403 = a pessoa bloqueou o bot ou apagou a conversa. O vínculo fica:
      // ao desbloquear, os avisos voltam sem precisar conectar de novo.
      const bloqueado = r.reason instanceof TelegramError && r.reason.codigo === 403
      const motivo = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.error(
        `[telegram] notificação ${categoria} para ${envios[i].destinatario.email ?? envios[i].destinatario.chatId}` +
          `${bloqueado ? ' (bot bloqueado)' : ''}: ${motivo}`
      )
    })
    return enviados
  } catch (err) {
    console.error(`[telegram] notificação ${categoria}:`, err instanceof Error ? err.message : err)
    return 0
  }
}

/** Avisa todos os conectados, menos quem fez a ação — o mesmo critério do push. */
export function notificarTelegramExceto(
  categoria: CategoriaNotificacaoTelegram,
  autorEmail: string | null | undefined,
  msg: MensagemTelegram
): Promise<number> {
  const autor = (autorEmail ?? '').trim().toLowerCase()
  return notificarTelegram(categoria, d => (autor && (d.email ?? '').toLowerCase() === autor ? null : msg))
}
