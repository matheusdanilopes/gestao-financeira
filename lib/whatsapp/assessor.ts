/**
 * Processa uma mensagem recebida no WhatsApp e responde como assessor
 * financeiro, com os dados do usuário dono do número.
 *
 * Fluxo: dedupe → vínculo → (áudio → transcrição) → comandos → turno do
 * agente (o mesmo do chat do app) → resposta formatada para o WhatsApp.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { garantirConversa } from '../ai/agent/conversation'
import { executarTurno, descreverErro } from '../ai/agent/turno'
import { criarInterlocutor, responsavelDoEmail } from '../ai/agent/interlocutor'
import { transcreverAudio } from '../ai/agent/geminiClient'
import { enviarTexto, marcarLidaDigitando, baixarMidia } from './cloudApi'
import { markdownParaWhatsApp, dividirMensagem } from './formatacao'
import { extrairCodigo } from './vinculo'
import { CONVERSA_OCIOSA_MS, EXEMPLOS_PERGUNTA, identificarComando } from '../ai/agent/comandos'

/** Formato (parcial) de `entry[].changes[].value.messages[]` da Cloud API. */
export interface MensagemRecebida {
  id: string
  from: string
  timestamp?: string
  type: string
  text?: { body?: string }
  audio?: { id?: string; mime_type?: string }
  button?: { text?: string }
  interactive?: {
    button_reply?: { title?: string }
    list_reply?: { title?: string }
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
/** O "digitando…" some sozinho após ~25 s; renovamos enquanto o agente trabalha. */
const RENOVAR_DIGITANDO_MS = 20_000
const RETENCAO_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000

const PASSO_A_PASSO_VINCULO =
  'Para conectar: abra o app → *Configurações* → aba *Conta* → *Assessor no WhatsApp* → *Gerar código*, ' +
  'e envie aqui a mensagem com o código (ex.: _vincular ABCD-EFGH_).'

function ajuda(nome: string | null): string {
  return [
    `Oi${nome ? `, ${nome}` : ''}! Sou seu assessor financeiro 🤝 Pode me perguntar por texto ou áudio, por exemplo:`,
    ...EXEMPLOS_PERGUNTA.map(e => `• ${e}`),
    '',
    'Quando falar na primeira pessoa ("eu", "meu"), respondo com os *seus* dados. Antes de lançar qualquer coisa, eu mostro o resumo e espero você confirmar.',
    '',
    'Comandos: *nova conversa* (começa um assunto do zero) · *desvincular* (desconecta este número).',
  ].join('\n')
}

async function responder(para: string, texto: string): Promise<void> {
  for (const parte of dividirMensagem(markdownParaWhatsApp(texto))) {
    await enviarTexto(para, parte)
  }
}

/** true se a mensagem é nova; false se já foi processada (reentrega da Meta). */
async function registrarRecebimento(admin: SupabaseClient, wamid: string): Promise<boolean> {
  const { error } = await admin.from('whatsapp_mensagens_processadas').insert({ wamid })
  if (!error) return true
  if (error.code === '23505') return false
  // Sem a tabela não há dedupe, mas responder é melhor que ficar mudo.
  console.error('[whatsapp] dedupe:', error.message)
  return true
}

async function vincular(admin: SupabaseClient, telefone: string, codigo: string): Promise<string> {
  const { data } = await admin
    .from('whatsapp_vinculos')
    .select('id, email, codigo_expira_em')
    .eq('codigo', codigo)
    .maybeSingle()

  if (!data || !data.codigo_expira_em || new Date(data.codigo_expira_em).getTime() < Date.now()) {
    return `Esse código é inválido ou já expirou. Gere um novo no app e envie aqui. ${PASSO_A_PASSO_VINCULO}`
  }

  // Um número só pode estar ligado a uma conta: se estava em outra, sai de lá.
  await admin
    .from('whatsapp_vinculos')
    .update({ telefone: null, conversation_id: null })
    .eq('telefone', telefone)
    .neq('id', data.id)

  const { error } = await admin
    .from('whatsapp_vinculos')
    .update({
      telefone,
      codigo: null,
      codigo_expira_em: null,
      vinculado_em: new Date().toISOString(),
      conversation_id: null,
      ultima_interacao_em: null,
    })
    .eq('id', data.id)

  if (error) {
    console.error('[whatsapp] vincular:', error.message)
    return 'Não consegui concluir o vínculo agora. Tente enviar o código de novo em instantes.'
  }

  const nome = responsavelDoEmail(data.email)
  return `✅ Pronto! Este WhatsApp está conectado à sua conta no app.\n\n${ajuda(nome)}`
}

/** Conversa atual do número — reaproveita a recente ou abre outra. */
async function conversaDoVinculo(admin: SupabaseClient, v: Vinculo): Promise<string> {
  const recente =
    v.conversation_id &&
    v.ultima_interacao_em &&
    Date.now() - new Date(v.ultima_interacao_em).getTime() < CONVERSA_OCIOSA_MS

  // garantirConversa valida que a conversa ainda existe e é do usuário
  // (ela pode ter sido apagada pelo histórico do app); se não, cria outra.
  const conversationId = await garantirConversa(admin, recente ? v.conversation_id : null, v.user_id)

  await admin
    .from('whatsapp_vinculos')
    .update({ conversation_id: conversationId, ultima_interacao_em: new Date().toISOString() })
    .eq('id', v.id)

  return conversationId
}

/** Texto da mensagem, ou null para tipos sem texto (áudio é tratado à parte). */
function textoDaMensagem(msg: MensagemRecebida): string | null {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? null
    case 'button':
      return msg.button?.text ?? null
    case 'interactive':
      return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null
    default:
      return null
  }
}

export async function processarMensagem(
  admin: SupabaseClient,
  msg: MensagemRecebida,
  deadlineMs: number
): Promise<void> {
  const de = msg.from
  if (!de || !msg.id) return
  if (!(await registrarRecebimento(admin, msg.id))) return

  await marcarLidaDigitando(msg.id)

  let texto = textoDaMensagem(msg)?.trim() || null

  // Vínculo vem antes de tudo: é a única coisa que um número desconhecido pode fazer.
  const codigo = texto ? extrairCodigo(texto) : null
  if (codigo) {
    await responder(de, await vincular(admin, de, codigo))
    return
  }

  const { data: vinculo } = await admin
    .from('whatsapp_vinculos')
    .select('id, user_id, email, conversation_id, ultima_interacao_em')
    .eq('telefone', de)
    .maybeSingle<Vinculo>()

  if (!vinculo) {
    await responder(
      de,
      `Olá! 👋 Sou o assessor do app de gestão financeira, mas este número ainda não está vinculado a uma conta.\n\n${PASSO_A_PASSO_VINCULO}`
    )
    return
  }

  const interlocutor = criarInterlocutor(vinculo.email, 'whatsapp')
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    await responder(de, 'A IA do app não está configurada no servidor (falta a GEMINI_API_KEY).')
    return
  }

  // Renova o "digitando…" enquanto transcreve/consulta.
  const digitando = setInterval(() => { void marcarLidaDigitando(msg.id) }, RENOVAR_DIGITANDO_MS)

  try {
    let transcricao: string | null = null
    if (msg.type === 'audio' && msg.audio?.id) {
      const midia = await baixarMidia(msg.audio.id)
      transcricao = midia
        ? await transcreverAudio(apiKey, midia.base64, midia.mimeType, Math.min(deadlineMs, Date.now() + 25_000))
        : null
      if (!transcricao) {
        await responder(de, 'Não consegui entender o áudio 😕 Pode repetir ou mandar por texto?')
        return
      }
      texto = transcricao
    }

    if (!texto) {
      await responder(de, 'Por enquanto eu entendo mensagens de texto e de áudio. Pode me mandar sua pergunta assim?')
      return
    }

    const comando = identificarComando(texto)
    if (comando === 'ajuda') {
      await responder(de, ajuda(interlocutor.nome))
      return
    }
    if (comando === 'nova') {
      await admin.from('whatsapp_vinculos').update({ conversation_id: null }).eq('id', vinculo.id)
      await responder(de, 'Certo, começamos uma conversa nova. Em que posso ajudar? 🙂')
      return
    }
    if (comando === 'desvincular') {
      await admin
        .from('whatsapp_vinculos')
        .update({ telefone: null, conversation_id: null, vinculado_em: null })
        .eq('id', vinculo.id)
      await responder(de, 'Número desvinculado. Não vou mais responder sobre suas finanças por aqui. Para voltar, gere um novo código no app.')
      return
    }

    const conversationId = await conversaDoVinculo(admin, vinculo)

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
      console.error('[whatsapp] turno:', err instanceof Error ? err.message : err)
      resposta = descreverErro(err).mensagem
    }

    if (transcricao) {
      // Ecoa o que foi entendido: num "paguei 180 de luz" por voz, é o que
      // permite à pessoa perceber um erro de transcrição antes de confirmar.
      const eco = transcricao.length > 300 ? `${transcricao.slice(0, 300)}…` : transcricao
      resposta = `🎤 _"${eco}"_\n\n${resposta}`
    }

    await responder(de, resposta || 'Não consegui formular a resposta agora. Pode reformular a pergunta?')
  } finally {
    clearInterval(digitando)
  }
}

/** Remove ids antigos da tabela de dedupe — a Meta não reentrega depois de dias. */
export async function limparDedupe(admin: SupabaseClient): Promise<void> {
  const limite = new Date(Date.now() - RETENCAO_DEDUPE_MS).toISOString()
  await admin.from('whatsapp_mensagens_processadas').delete().lt('recebida_em', limite)
}
