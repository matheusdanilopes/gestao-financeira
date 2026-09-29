/**
 * Um turno completo do assessor, independente do canal.
 *
 *   conversa → dataset validado → prompt → loop do agente → persistência
 *
 * O chat do app (/api/chat, em SSE) e o WhatsApp (/api/whatsapp/webhook)
 * passam por aqui: mesmos dados, mesmas ferramentas, mesmas travas de
 * confirmação. O que muda entre eles é só como o texto chega ao usuário.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEnrichedData, DadosIndisponiveisError } from '../contextBuilder'
import { validateFinancialData } from '../financialValidationEngine'
import { computeInsights } from '../insightsEngine'
import type { TelaAtual } from '../types'
import { construirReferencias } from './queryEngine'
import { buildSystemPrompt, buildBlockedPrompt } from './systemPrompt'
import { executarAgente, type AgentEvent } from './runAgent'
import { GeminiError } from './geminiClient'
import { carregarContexto, salvarMensagem } from './conversation'
import type { Interlocutor } from './interlocutor'

export interface EntradaTurno {
  apiKey: string
  supabase: SupabaseClient
  userId: string
  interlocutor: Interlocutor
  conversationId: string
  /** Pergunta já montada (com o contexto da tela, se houver). */
  pergunta: string
  tela?: TelaAtual
  /** true quando o cliente está repetindo uma pergunta que já foi gravada. */
  reenvio?: boolean
  deadlineMs: number
}

/**
 * Emite os eventos do agente. O `done` só sai depois que a resposta foi
 * gravada na conversa. Erros são lançados — cada canal decide como mostrá-los
 * (ver `descreverErro`).
 */
export async function* executarTurno(e: EntradaTurno): AsyncGenerator<AgentEvent> {
  const { supabase, conversationId, pergunta } = e

  const contexto = await carregarContexto(supabase, e.apiKey, conversationId, e.deadlineMs)

  // Grava a pergunta antes de chamar o modelo: se o turno falhar no meio,
  // a conversa persiste coerente e o usuário pode simplesmente repetir.
  // Num reenvio ela já está gravada — regravar duplicaria o histórico.
  if (e.reenvio !== true) {
    await salvarMensagem(supabase, conversationId, 'user', pergunta)
  }

  yield { type: 'status', texto: 'Lendo seus dados financeiros' }

  // Força leitura fresca na primeira mensagem da conversa: o usuário pode
  // ter acabado de lançar uma despesa em outra tela.
  // Cliente autenticado (não a anon key crua): é o que permite ler tabelas
  // protegidas por RLS, como os limites de parcelamento.
  const brutos = await fetchEnrichedData(e.userId, contexto.ehPrimeiraMensagem, supabase)
  const { validatedData, certificate } = validateFinancialData(brutos)
  // Relógio de Brasília: o servidor roda em UTC e "virava o dia" às 21h.
  const refs = construirReferencias()

  const bloqueado = !certificate.certificado
  const systemPrompt = bloqueado
    ? buildBlockedPrompt(certificate, e.interlocutor)
    : buildSystemPrompt({
        data: validatedData,
        metrics: computeInsights(validatedData, refs.hoje),
        refs,
        certificate,
        tela: e.tela,
        resumoConversa: contexto.resumo,
        interlocutor: e.interlocutor,
      })

  // Num reenvio a pergunta já veio no histórico carregado — remover a
  // duplicata evita dois turnos 'user' idênticos e seguidos no prompt.
  const historico = e.reenvio === true
    ? contexto.mensagens.filter((m, i, arr) =>
        !(i === arr.length - 1 && m.role === 'user' && m.content === pergunta))
    : contexto.mensagens

  let textoFinal = ''
  let ferramentas: string[] = []

  for await (const evento of executarAgente({
    apiKey: e.apiKey,
    systemPrompt,
    historico,
    pergunta,
    data: validatedData,
    refs,
    semFerramentas: bloqueado,
    deadlineMs: e.deadlineMs,
    escrita: {
      supabase,
      conversationId,
      usuario: e.interlocutor.email,
      responsavelPadrao: e.interlocutor.nome,
    },
  })) {
    if (evento.type === 'done') {
      textoFinal = evento.texto
      ferramentas = evento.ferramentas
    } else {
      yield evento
    }
  }

  if (textoFinal) {
    await salvarMensagem(supabase, conversationId, 'assistant', textoFinal)
  }
  yield { type: 'done', texto: textoFinal, ferramentas }
}

export interface ErroDescrito {
  codigo: string
  mensagem: string
  diaria?: boolean
  segundos?: number | null
}

export function descreverErro(err: unknown): ErroDescrito {
  if (err instanceof DadosIndisponiveisError) {
    // Sem compras ou sem planejamento a análise sairia errada — melhor dizer.
    return { codigo: 'DADOS', mensagem: 'Não consegui ler seus dados financeiros agora. Tente de novo em instantes.' }
  }
  if (err instanceof GeminiError) {
    switch (err.codigo) {
      case 'QUOTA':
        return {
          codigo: 'QUOTA',
          diaria: err.detalhes?.diaria ?? false,
          segundos: err.detalhes?.segundos ?? null,
          mensagem: err.detalhes?.diaria
            ? 'A cota diária da IA foi atingida. Ela volta a responder amanhã.'
            : err.detalhes?.segundos
              ? `Muitas perguntas em pouco tempo. Tente de novo em ${err.detalhes.segundos}s.`
              : 'Muitas perguntas em pouco tempo. Aguarde alguns segundos e tente de novo.',
        }
      case 'OVERLOADED':
        return { codigo: 'OVERLOADED', mensagem: 'O serviço de IA está congestionado. Já tentei algumas vezes — tente de novo em instantes.' }
      case 'TIMEOUT':
        return { codigo: 'TIMEOUT', mensagem: 'A consulta demorou mais do que o esperado. Tente perguntar de novo, de preferência de forma mais específica.' }
      case 'CONFIG':
        return { codigo: 'CONFIG', mensagem: 'A IA recusou a requisição (configuração da chave ou do modelo). Verifique a GEMINI_API_KEY.' }
    }
  }
  return { codigo: 'INTERNO', mensagem: 'Algo falhou ao montar a resposta. Tente novamente em instantes.' }
}
