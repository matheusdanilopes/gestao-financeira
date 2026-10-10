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
 *   aviso   { texto }          algo além da resposta (ex.: troca não salva)
 *   done    { texto, ferramentas }
 *   error   { codigo, mensagem, diaria?, segundos? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import type { AgentEvent } from '@/lib/ai/agent/runAgent'
import { garantirConversa } from '@/lib/ai/agent/conversation'
import { executarTurno, descreverErro } from '@/lib/ai/agent/turno'
import { criarInterlocutor } from '@/lib/ai/agent/interlocutor'
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
    /** Mensagens na tela — reserva se o histórico gravado estiver incompleto. */
    historico?: unknown
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

        for await (const evento of executarTurno({
          apiKey,
          supabase,
          userId: user.id,
          // Quem pergunta na primeira pessoa é o usuário logado.
          interlocutor: criarInterlocutor(user.email, 'app'),
          conversationId,
          pergunta: conteudoUsuario,
          tela: body.tela,
          reenvio: body.reenvio,
          historicoCliente: body.historico,
          deadlineMs,
        })) {
          despachar(evento, enviar)
        }
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

/** Traduz um evento do turno para o canal SSE. */
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
    case 'aviso':
      enviar('aviso', { texto: evento.texto })
      break
    case 'done':
      // Só chega depois que a resposta foi gravada na conversa.
      enviar('done', { texto: evento.texto, ferramentas: evento.ferramentas })
      break
  }
}
