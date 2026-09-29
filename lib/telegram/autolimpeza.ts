/**
 * Limpeza automática do chat do Telegram.
 *
 * O histórico real fica no app (tabela messages); o chat do Telegram só
 * mostra a conversa enquanto ela acontece. Cada mensagem vira uma linha em
 * telegram_mensagens — sempre DEPOIS de gravada no histórico — e é apagada
 * quando apagar_em vence:
 *
 *   recebidas → TELEGRAM_APAGAR_RECEBIDAS_APOS_S depois de processadas (padrão 0)
 *   enviadas  → TELEGRAM_APAGAR_RESPOSTAS_APOS_S depois de enviadas (padrão 60)
 *   com botões Confirmar/Cancelar → só depois do toque (ou em 24 h)
 *
 * Quem apaga: o próprio webhook, que espera o atraso na mesma execução, e a
 * rotina /api/telegram/limpeza, que recolhe o que ficou pendente. Nada aqui
 * lança erro — uma exclusão que falha nunca derruba a resposta do bot.
 *
 * TELEGRAM_AUTOLIMPEZA=off desliga o agendamento de novas exclusões.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { apagarMensagem } from './botApi'

const HORA_MS = 60 * 60 * 1000

/**
 * A Bot API só apaga mensagens com menos de 48 h. Uma hora de margem evita
 * gastar a chamada numa mensagem que venceria no meio do caminho.
 */
export const JANELA_APAGAVEL_MS = 47 * HORA_MS
/** Mensagem com botões que ninguém tocou some depois disso. */
const ESPERA_TOQUE_MS = 24 * HORA_MS
/** Falhas temporárias seguidas antes de desistir de uma mensagem. */
const MAX_TENTATIVAS = 8
/** Espera entre tentativas: 30 s, 1 min, 2 min, 4 min… até 6 h. */
const ESPERA_BASE_MS = 30_000
const ESPERA_MAX_MS = 6 * HORA_MS
/**
 * ~15 chamadas por segundo, abaixo do limite global de 30/s da Bot API — a
 * limpeza nunca disputa a cota com as respostas.
 */
const INTERVALO_ENTRE_EXCLUSOES_MS = 70
const LOTE = 50
/** Linhas já resolvidas ficam um tempo para auditoria e depois saem. */
const RETENCAO_REGISTROS_MS = 30 * 24 * HORA_MS

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

export function autolimpezaAtiva(): boolean {
  return (process.env.TELEGRAM_AUTOLIMPEZA ?? '').trim().toLowerCase() !== 'off'
}

function segundosDoEnv(nome: string, padrao: number): number {
  const bruto = process.env[nome]
  if (bruto === undefined || bruto.trim() === '') return padrao
  const n = Number(bruto)
  return Number.isFinite(n) && n >= 0 ? n : padrao
}

export const atrasoRespostasMs = () => segundosDoEnv('TELEGRAM_APAGAR_RESPOSTAS_APOS_S', 60) * 1000
export const atrasoRecebidasMs = () => segundosDoEnv('TELEGRAM_APAGAR_RECEBIDAS_APOS_S', 0) * 1000

export interface MensagemParaApagar {
  chatId: number
  messageId: number
  direcao: 'recebida' | 'enviada'
  /** Linha de messages que guarda o conteúdo — sem ela, a mensagem não é apagada. */
  mensagemAppId: string
  /** Unix time (segundos) do Telegram. */
  data: number
  atrasoMs: number
  aguardandoToque?: boolean
}

/** Põe uma mensagem na fila de exclusão. Falhas só vão para o log. */
export async function agendarExclusao(admin: SupabaseClient, m: MensagemParaApagar): Promise<void> {
  if (!autolimpezaAtiva()) return
  const agora = Date.now()
  const apagarEm = agora + (m.aguardandoToque ? ESPERA_TOQUE_MS : m.atrasoMs)
  const { error } = await admin.from('telegram_mensagens').upsert(
    {
      chat_id: m.chatId,
      message_id: m.messageId,
      direcao: m.direcao,
      mensagem_app_id: m.mensagemAppId,
      enviada_em: new Date(m.data * 1000).toISOString(),
      apagar_em: new Date(apagarEm).toISOString(),
      aguardando_toque: m.aguardandoToque === true,
    },
    { onConflict: 'chat_id,message_id', ignoreDuplicates: true }
  )
  if (error) console.error('[telegram] agendar exclusão:', error.message)
}

/** Toque em Confirmar/Cancelar: a mensagem com os botões entra no prazo normal. */
export async function liberarAposToque(admin: SupabaseClient, chatId: number, messageId: number): Promise<void> {
  const { error } = await admin
    .from('telegram_mensagens')
    .update({
      aguardando_toque: false,
      apagar_em: new Date(Date.now() + atrasoRespostasMs()).toISOString(),
    })
    .eq('chat_id', chatId)
    .eq('message_id', messageId)
    .eq('status', 'pendente')
  if (error) console.error('[telegram] liberar após toque:', error.message)
}

interface Pendente {
  id: number
  chat_id: number
  message_id: number
  enviada_em: string
  tentativas: number
}

export interface ResumoLimpeza {
  apagadas: number
  naoApagaveis: number
  falhas: number
  reagendadas: number
  /** O Telegram pediu para esperar (429): o lote parou antes do fim. */
  limitada: boolean
}

async function concluir(
  admin: SupabaseClient,
  id: number,
  campos: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from('telegram_mensagens')
    .update(campos)
    .eq('id', id)
    .eq('status', 'pendente')
  if (error) console.error('[telegram] atualizar fila de exclusão:', error.message)
}

/**
 * Apaga o que venceu. Para no `ateMs` (orçamento da função) e num 429 longo —
 * o que sobrar continua na fila para a próxima execução.
 */
export async function apagarVencidas(admin: SupabaseClient, ateMs: number): Promise<ResumoLimpeza> {
  const resumo: ResumoLimpeza = { apagadas: 0, naoApagaveis: 0, falhas: 0, reagendadas: 0, limitada: false }

  const { data, error } = await admin
    .from('telegram_mensagens')
    .select('id, chat_id, message_id, enviada_em, tentativas')
    .eq('status', 'pendente')
    .lte('apagar_em', new Date().toISOString())
    .order('apagar_em', { ascending: true })
    .limit(LOTE)
  if (error) {
    console.error('[telegram] ler fila de exclusão:', error.message)
    return resumo
  }

  for (const p of (data ?? []) as Pendente[]) {
    if (Date.now() >= ateMs) break

    const enviadaMs = new Date(p.enviada_em).getTime()
    const fimDaJanela = enviadaMs + JANELA_APAGAVEL_MS
    if (Date.now() >= fimDaJanela) {
      // Fora da janela de 48 h: marca e esquece, sem chamar a API de novo.
      await concluir(admin, p.id, {
        status: 'nao_apagavel',
        ultimo_erro: 'Mais de 48 h: o Telegram não permite mais apagar',
      })
      resumo.naoApagaveis++
      continue
    }

    const r = await apagarMensagem(p.chat_id, p.message_id)

    if (r.tipo === 'apagada' || r.tipo === 'inexistente') {
      await concluir(admin, p.id, {
        status: 'apagada',
        apagada_em: new Date().toISOString(),
        ultimo_erro: r.tipo === 'inexistente' ? 'Já não estava no chat' : null,
      })
      resumo.apagadas++
    } else if (r.tipo === 'definitivo') {
      console.warn(`[telegram] exclusão recusada (msg ${p.message_id}): ${r.motivo}`)
      await concluir(admin, p.id, {
        status: r.naoApagavel ? 'nao_apagavel' : 'falhou',
        tentativas: p.tentativas + 1,
        ultimo_erro: r.motivo.slice(0, 500),
      })
      if (r.naoApagavel) resumo.naoApagaveis++
      else resumo.falhas++
    } else {
      const tentativas = p.tentativas + 1
      console.warn(`[telegram] exclusão falhou (msg ${p.message_id}, tentativa ${tentativas}): ${r.motivo}`)
      if (tentativas >= MAX_TENTATIVAS) {
        await concluir(admin, p.id, { status: 'falhou', tentativas, ultimo_erro: r.motivo.slice(0, 500) })
        resumo.falhas++
      } else {
        const progressiva = Math.min(ESPERA_BASE_MS * 2 ** (tentativas - 1), ESPERA_MAX_MS)
        const pedida = (r.retryAfterS ?? 0) * 1000
        let proxima = Date.now() + Math.max(progressiva, pedida)
        // Garante ao menos uma tentativa antes de a mensagem sair da janela.
        if (proxima > fimDaJanela - 60_000) proxima = Math.max(Date.now() + pedida, fimDaJanela - 60_000)
        await concluir(admin, p.id, {
          tentativas,
          ultimo_erro: r.motivo.slice(0, 500),
          apagar_em: new Date(proxima).toISOString(),
        })
        resumo.reagendadas++
      }
      // Limite de requisições: o resto do lote espera a próxima execução.
      if (r.retryAfterS) {
        resumo.limitada = true
        break
      }
    }

    await esperar(INTERVALO_ENTRE_EXCLUSOES_MS)
  }

  return resumo
}

/** Quando vence a próxima exclusão (ms), ou null se a fila está vazia. */
async function proximaExclusao(admin: SupabaseClient): Promise<number | null> {
  const { data } = await admin
    .from('telegram_mensagens')
    .select('apagar_em')
    .eq('status', 'pendente')
    .order('apagar_em', { ascending: true })
    .limit(1)
    .maybeSingle<{ apagar_em: string }>()
  return data ? new Date(data.apagar_em).getTime() : null
}

/**
 * Usado pelo webhook depois de responder: apaga o que já venceu e, se a
 * próxima exclusão (a resposta que acabou de sair, tipicamente) vence antes
 * de `ateMs`, espera por ela. O que não couber fica para a rotina periódica.
 */
export async function apagarDentroDoPrazo(admin: SupabaseClient, ateMs: number): Promise<void> {
  if (!autolimpezaAtiva()) return
  for (let voltas = 0; voltas < 5 && Date.now() < ateMs; voltas++) {
    const { limitada } = await apagarVencidas(admin, ateMs)
    if (limitada) return
    const proxima = await proximaExclusao(admin)
    if (proxima === null || proxima > ateMs - 2_000) return
    await esperar(Math.max(0, proxima - Date.now()) + 250)
  }
}

/** Tira da tabela as linhas já resolvidas há mais de 30 dias. */
export async function limparRegistrosAntigos(admin: SupabaseClient): Promise<number> {
  const limite = new Date(Date.now() - RETENCAO_REGISTROS_MS).toISOString()
  const { count, error } = await admin
    .from('telegram_mensagens')
    .delete({ count: 'exact' })
    .neq('status', 'pendente')
    .lt('created_at', limite)
  if (error) console.error('[telegram] limpar registros antigos:', error.message)
  return count ?? 0
}
