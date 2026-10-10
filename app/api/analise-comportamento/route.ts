/**
 * POST /api/analise-comportamento — análise de comportamento financeiro sob
 * demanda, em streaming (SSE).
 *
 * Só roda quando o usuário pede (botão na tela): a análise lê todo o histórico
 * da janela e usa bastante raciocínio do modelo, então não faz sentido gastar
 * cota a cada visita à página.
 *
 *   auth → dados (GatewayDados, leitura fresca) → métricas determinísticas
 *        → analista (Gemini, JSON estruturado) → SSE
 *
 * Eventos:
 *   status   { texto }            etapa em andamento
 *   metricas { metricas }         números prontos — a tela já mostra os gráficos
 *   done     { resultado }        análise completa (ResultadoAnalise)
 *   error    { codigo, mensagem }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { GatewayDados } from '@/lib/ai/data/gateway'
import { agoraBrasil } from '@/lib/ai/tempo'
import { descreverErro } from '@/lib/ai/agent/turno'
import { responsavelDoEmail } from '@/lib/ai/agent/interlocutor'
import { calcularMetricas } from '@/lib/comportamento/metricas'
import { analisarComportamento, AnaliseFormatoError } from '@/lib/comportamento/analista'
import {
  JANELAS_ANALISE,
  OBJETIVOS_ANALISE,
  type EscopoAnalise,
  type JanelaAnalise,
  type ObjetivoAnalise,
  type ParametrosAnalise,
  type ResultadoAnalise,
} from '@/lib/comportamento/tipos'

export const maxDuration = 120

const ORCAMENTO_MS = 105_000
const LIMITE_CONTEXTO = 400
const ESCOPOS: EscopoAnalise[] = ['casal', 'Matheus', 'Jeniffer']

function sse(tipo: string, payload: unknown): string {
  return `event: ${tipo}\ndata: ${JSON.stringify(payload)}\n\n`
}

function lerParametros(body: Record<string, unknown>): ParametrosAnalise {
  const janela = Number(body.janela)
  const escopo = String(body.escopo ?? 'casal')
  const objetivo = String(body.objetivo ?? 'entender')
  const contexto = typeof body.contexto === 'string' ? body.contexto.trim().slice(0, LIMITE_CONTEXTO) : ''
  return {
    janela: (JANELAS_ANALISE as readonly number[]).includes(janela) ? (janela as JanelaAnalise) : 12,
    escopo: ESCOPOS.includes(escopo as EscopoAnalise) ? (escopo as EscopoAnalise) : 'casal',
    objetivo: OBJETIVOS_ANALISE.some(o => o.chave === objetivo) ? (objetivo as ObjetivoAnalise) : 'entender',
    ...(contexto ? { contexto } : {}),
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada', errorCode: 'CONFIG' }, { status: 500 })
  }

  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const parametros = lerParametros(body)
  const deadlineMs = Date.now() + ORCAMENTO_MS
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (tipo: string, payload: unknown) => {
        try { controller.enqueue(encoder.encode(sse(tipo, payload))) }
        catch { /* cliente desconectou */ }
      }

      try {
        enviar('status', { texto: 'Lendo todo o seu histórico financeiro' })
        // Leitura fresca: a análise precisa refletir o que acabou de ser lançado.
        const gateway = new GatewayDados(supabase, user.id)
        const { dados, certificado } = await gateway.iniciar(true)
        const hoje = agoraBrasil()

        enviar('status', { texto: 'Calculando seus padrões de comportamento' })
        const primeiro = gateway.cobertura.primeiroNoBanco
        const metricas = calcularMetricas(dados, parametros, hoje, primeiro)
        if (!certificado.certificado) {
          metricas.qualidade.avisos.push(`A auditoria dos dados encontrou inconsistências: ${certificado.resumo}`)
        }
        enviar('metricas', { metricas })

        if (metricas.qualidade.comprasAnalisadas === 0 && metricas.resumo.gastoMedio === 0) {
          enviar('error', {
            codigo: 'SEM_DADOS',
            mensagem: 'Não há lançamentos suficientes no período para analisar. Importe suas faturas ou escolha um período maior.',
          })
          return
        }

        enviar('status', { texto: 'O analista está estudando seus dados' })
        const analise = await analisarComportamento({
          apiKey,
          metricas,
          parametros,
          nomeUsuario: responsavelDoEmail(user.email),
          deadlineMs,
        })

        const resultado: ResultadoAnalise = {
          parametros,
          metricas,
          analise,
          geradaEm: new Date().toISOString(),
        }
        enviar('done', { resultado })
      } catch (err) {
        console.error('[analise-comportamento]', err instanceof Error ? err.message : err)
        if (err instanceof AnaliseFormatoError) {
          enviar('error', {
            codigo: 'FORMATO',
            mensagem: 'O analista não conseguiu concluir o relatório desta vez. Tente de novo — se persistir, escolha um período menor.',
          })
        } else {
          enviar('error', descreverErro(err))
        }
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
      'X-Accel-Buffering': 'no',
    },
  })
}
