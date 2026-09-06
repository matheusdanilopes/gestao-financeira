/**
 * POST /api/chat — turno do assistente financeiro, em streaming (SSE).
 *
 * Fluxo:
 *   auth → conversa → dataset validado → prompt → loop do agente → SSE
 *
 * Por que SSE e não JSON: com ferramentas encadeadas um turno pode levar
 * dezenas de segundos. Respondendo em bloco, o usuário fica olhando um spinner
 * e, se o limite da função estourar, a plataforma devolve HTML — que o cliente
 * lia como "erro de conexão". Em streaming o texto aparece conforme é gerado e
 * qualquer falha vira um evento `error` explícito no mesmo canal.
 *
 * Eventos emitidos (cada um `event: <tipo>` + `data: <json>`):
 *   meta    { conversation_id }
 *   status  { texto }          progresso legível ("Consultando compras…")
 *   tool    { nome, rotulo }   ferramenta executada (trilha de auditoria)
 *   delta   { texto }          pedaço da resposta
 *   reset   {}                 descarte o texto parcial desta rodada
 *   done    { texto, ferramentas }
 *   error   { codigo, mensagem, diaria?, segundos? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { fetchEnrichedData } from '@/lib/ai/contextBuilder'
import { validateFinancialData } from '@/lib/ai/financialValidationEngine'
import { computeInsights } from '@/lib/ai/insightsEngine'
import { construirReferencias } from '@/lib/ai/agent/queryEngine'
import { buildSystemPrompt, buildBlockedPrompt } from '@/lib/ai/agent/systemPrompt'
import { executarAgente, type AgentEvent } from '@/lib/ai/agent/runAgent'
import { GeminiError } from '@/lib/ai/agent/geminiClient'
import { garantirConversa, carregarContexto, salvarMensagem } from '@/lib/ai/agent/conversation'
import type { TelaAtual } from '@/lib/ai/types'

// O loop do agente pode encadear consultas; o orçamento interno (ORCAMENTO_MS)
// fica abaixo deste limite para sempre degradar com uma resposta em vez de ser
// morto no meio pela plataforma.
export const maxDuration = 90

const ORCAMENTO_MS = 75_000
const LIMITE_PERGUNTA = 2_000
const LIMITE_DADOS_EXTRA = 4_000

function sse(tipo: string, payload: unknown): string {
  return `event: ${tipo}\ndata: ${JSON.stringify(payload)}\n\n`
}

function descreverErro(err: unknown): {
  codigo: string
  mensagem: string
  diaria?: boolean
  segundos?: number | null
} {
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

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY não configurada', errorCode: 'CONFIG' },
      { status: 500 }
    )
  }

  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: {
    pergunta?: string
    dados?: string
    tela?: TelaAtual
    conversation_id?: string
    /** true quando o cliente está repetindo uma pergunta que já foi gravada. */
    reenvio?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const pergunta = body.pergunta?.trim().slice(0, LIMITE_PERGUNTA)
  if (!pergunta) {
    return NextResponse.json({ error: 'pergunta é obrigatória' }, { status: 400 })
  }
  const dadosExtra = body.dados?.trim().slice(0, LIMITE_DADOS_EXTRA)
  const conteudoUsuario = dadosExtra ? `${pergunta}\n\nContexto da tela:\n${dadosExtra}` : pergunta

  const deadlineMs = Date.now() + ORCAMENTO_MS

  // Tudo que pode falhar ANTES do primeiro byte é resolvido aqui, para que o
  // cliente receba um JSON de erro com status HTTP correto em vez de um stream
  // que morre na primeira linha.
  let conversationId: string
  try {
    conversationId = await garantirConversa(supabase, body.conversation_id ?? null, user.id)
  } catch (err) {
    console.error('[chat] conversa:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Não foi possível abrir a conversa' }, { status: 500 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (tipo: string, payload: unknown) => {
        try { controller.enqueue(encoder.encode(sse(tipo, payload))) }
        catch { /* cliente desconectou */ }
      }

      try {
        enviar('meta', { conversation_id: conversationId })

        const contexto = await carregarContexto(supabase, apiKey, conversationId, deadlineMs)

        // Grava a pergunta antes de chamar o modelo: se o turno falhar no meio,
        // a conversa persiste coerente e o usuário pode simplesmente repetir.
        // Num reenvio ela já está gravada — regravar duplicaria o histórico.
        if (body.reenvio !== true) {
          await salvarMensagem(supabase, conversationId, 'user', conteudoUsuario)
        }

        enviar('status', { texto: 'Lendo seus dados financeiros' })

        // Força leitura fresca na primeira mensagem da conversa: o usuário pode
        // ter acabado de lançar uma despesa em outra tela.
        const brutos = await fetchEnrichedData(user.id, contexto.ehPrimeiraMensagem)
        const { validatedData, certificate } = validateFinancialData(brutos)
        const refs = construirReferencias()

        const bloqueado = !certificate.certificado
        const systemPrompt = bloqueado
          ? buildBlockedPrompt(certificate)
          : buildSystemPrompt({
              data: validatedData,
              metrics: computeInsights(validatedData),
              refs,
              certificate,
              tela: body.tela,
              resumoConversa: contexto.resumo,
            })

        let textoFinal = ''
        let ferramentas: string[] = []

        // Num reenvio a pergunta já veio no histórico carregado — remover a
        // duplicata evita dois turnos 'user' idênticos e seguidos no prompt.
        const historico = body.reenvio === true
          ? contexto.mensagens.filter((m, i, arr) =>
              !(i === arr.length - 1 && m.role === 'user' && m.content === conteudoUsuario))
          : contexto.mensagens

        for await (const evento of executarAgente({
          apiKey,
          systemPrompt,
          historico,
          pergunta: conteudoUsuario,
          data: validatedData,
          refs,
          semFerramentas: bloqueado,
          deadlineMs,
        })) {
          despachar(evento, enviar)
          if (evento.type === 'done') {
            textoFinal = evento.texto
            ferramentas = evento.ferramentas
          }
        }

        if (textoFinal) {
          await salvarMensagem(supabase, conversationId, 'assistant', textoFinal)
        }
        enviar('done', { texto: textoFinal, ferramentas })
      } catch (err) {
        console.error('[chat]', err instanceof Error ? err.message : err)
        enviar('error', descreverErro(err))
      } finally {
        try { controller.close() } catch { /* já fechado */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Evita buffering em proxies (o stream chegaria de uma vez só no fim).
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Traduz um evento do agente para o canal SSE (o `done` é emitido pela rota). */
function despachar(evento: AgentEvent, enviar: (tipo: string, payload: unknown) => void) {
  switch (evento.type) {
    case 'status':
      enviar('status', { texto: evento.texto })
      break
    case 'tool':
      enviar('tool', { nome: evento.nome, rotulo: evento.rotulo })
      break
    case 'delta':
      enviar('delta', { texto: evento.texto })
      break
    case 'reset':
      enviar('reset', {})
      break
    case 'done':
      // Emitido pela rota depois de persistir a mensagem.
      break
  }
}
