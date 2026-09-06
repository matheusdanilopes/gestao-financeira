/**
 * Cliente Gemini para o agente de chat.
 *
 * Duas capacidades que a implementação anterior não tinha e que são a razão da
 * tela "travar" ou responder vazio:
 *  1. STREAMING (streamGenerateContent + SSE) — o texto chega em pedaços, então
 *     o usuário vê a resposta nascer em vez de esperar até 60s por um bloco só,
 *     e uma resposta longa não é perdida se a função se aproximar do limite.
 *  2. Um orçamento de tempo (deadline) COMPARTILHADO por todas as chamadas do
 *     turno, para que várias rodadas de ferramenta nunca estourem o maxDuration
 *     da plataforma — o que antes matava a requisição no meio e chegava ao
 *     cliente como HTML, não JSON ("erro de conexão").
 */

import type { FunctionDeclaration } from './tools'

export const GEMINI_MODEL = 'gemini-2.5-flash'
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// ─── Tipos do protocolo ──────────────────────────────────────────────────────

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

export interface GeminiContent {
  role: 'user' | 'model' | 'function'
  parts: GeminiPart[]
}

export interface ChamadaFerramenta {
  name: string
  args: Record<string, unknown>
}

/** Resultado de uma rodada: ou o modelo pediu ferramentas, ou produziu texto. */
export interface RodadaGemini {
  texto: string
  chamadas: ChamadaFerramenta[]
  finishReason?: string
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly codigo: 'QUOTA' | 'OVERLOADED' | 'TIMEOUT' | 'CONFIG' | 'DESCONHECIDO',
    readonly detalhes?: { diaria?: boolean; segundos?: number | null }
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

// ─── Retentativas ────────────────────────────────────────────────────────────

const MAX_TENTATIVAS = 3
const TIMEOUT_TENTATIVA_MS = 22_000

function classificarErroHttp(status: number, corpo: string): GeminiError | null {
  if (status === 429) {
    const match = corpo.match(/"retryDelay":\s*"(\d+)s"/)
    return new GeminiError('Cota do Gemini excedida', 'QUOTA', {
      diaria: corpo.includes('PerDay'),
      segundos: match ? parseInt(match[1], 10) : null,
    })
  }
  // Erros definitivos de cliente não devem ser retentados.
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return new GeminiError(`Gemini rejeitou a requisição (${status}): ${corpo.slice(0, 300)}`, 'CONFIG')
  }
  return null
}

interface OpcoesChamada {
  apiKey: string
  contents: GeminiContent[]
  systemInstruction?: string
  tools?: FunctionDeclaration[]
  deadlineMs: number
  temperature?: number
  maxOutputTokens?: number
}

function montarCorpo(opts: OpcoesChamada): string {
  return JSON.stringify({
    contents: opts.contents,
    ...(opts.systemInstruction
      ? { systemInstruction: { role: 'user', parts: [{ text: opts.systemInstruction }] } }
      : {}),
    ...(opts.tools && opts.tools.length > 0
      ? { tools: [{ functionDeclarations: opts.tools }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }
      : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    },
  })
}

interface TentativaOk {
  res: Response
  /** Cancela o timeout da tentativa. Obrigatório chamar ao terminar de ler o corpo. */
  liberar: () => void
}

/**
 * Executa uma tentativa HTTP respeitando o deadline compartilhado, com
 * backoff exponencial em 502/503/504 (orientação do próprio Google para
 * UNAVAILABLE) e backoff linear para falhas de rede.
 *
 * Em streaming o timeout da tentativa não pode ser o mesmo da chamada em
 * bloco: o corpo continua sendo lido depois do retorno, e um teto de poucos
 * segundos cortaria uma resposta longa no meio. Nesse caso o limite passa a
 * ser o orçamento restante do turno, e quem consome o corpo chama `liberar()`.
 */
async function comRetentativas(
  url: string,
  opts: OpcoesChamada,
  aceitaStream: boolean
): Promise<TentativaOk> {
  const corpo = montarCorpo(opts)
  let ultimoErro: Error | null = null
  let sobrecarregado = false

  for (let tentativa = 0; tentativa <= MAX_TENTATIVAS; tentativa++) {
    if (Date.now() >= opts.deadlineMs) break

    if (tentativa > 0) {
      const espera = sobrecarregado ? 1200 * 2 ** (tentativa - 1) : tentativa * 600
      const restante = opts.deadlineMs - Date.now()
      if (restante <= 0) break
      await new Promise(r => setTimeout(r, Math.min(espera, restante)))
    }

    const controller = new AbortController()
    const restante = Math.max(1000, opts.deadlineMs - Date.now())
    const timeout = aceitaStream ? restante : Math.min(TIMEOUT_TENTATIVA_MS, restante)
    const timer = setTimeout(() => controller.abort(), timeout)

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aceitaStream ? { Accept: 'text/event-stream' } : {}),
        },
        body: corpo,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      ultimoErro = err instanceof Error ? err : new Error('Falha de rede ao chamar o Gemini')
      sobrecarregado = false
      continue
    }

    if (res.ok) {
      // Em streaming o timer segue armado até o consumidor terminar de ler:
      // ele é a rede de segurança que interrompe a leitura ao fim do orçamento.
      if (!aceitaStream) clearTimeout(timer)
      return { res, liberar: () => clearTimeout(timer) }
    }

    clearTimeout(timer)
    const texto = await res.text()
    const definitivo = classificarErroHttp(res.status, texto)
    if (definitivo) throw definitivo

    ultimoErro = new Error(`Gemini HTTP ${res.status}: ${texto.slice(0, 300)}`)
    sobrecarregado = res.status === 502 || res.status === 503 || res.status === 504
  }

  if (sobrecarregado) throw new GeminiError('Modelo sobrecarregado', 'OVERLOADED')
  throw new GeminiError(ultimoErro?.message ?? 'Gemini indisponível após retentativas', 'TIMEOUT')
}

// ─── Extração de partes ──────────────────────────────────────────────────────

function extrairRodada(candidato: unknown): RodadaGemini {
  const c = candidato as { content?: { parts?: GeminiPart[] }; finishReason?: string } | undefined
  const parts = c?.content?.parts ?? []
  const chamadas: ChamadaFerramenta[] = []
  let texto = ''

  for (const p of parts) {
    if (p.functionCall?.name) {
      chamadas.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} })
    } else if (typeof p.text === 'string') {
      texto += p.text
    }
  }

  return { texto, chamadas, finishReason: c?.finishReason }
}

// ─── Chamada não-streaming (rodadas de raciocínio/ferramenta) ────────────────

export async function gerarRodada(opts: OpcoesChamada): Promise<RodadaGemini> {
  const url = `${BASE}/${GEMINI_MODEL}:generateContent?key=${opts.apiKey}`
  const { res } = await comRetentativas(url, opts, false)
  const json = await res.json()
  return extrairRodada(json.candidates?.[0])
}

// ─── Chamada com streaming (resposta final ao usuário) ───────────────────────

export interface PedacoStream {
  tipo: 'texto' | 'chamadas' | 'fim'
  texto?: string
  chamadas?: ChamadaFerramenta[]
  finishReason?: string
}

/**
 * Consome `streamGenerateContent?alt=sse` e emite pedaços conforme chegam.
 * Se o modelo decidir chamar uma ferramenta no meio do stream, emitimos as
 * chamadas para o chamador decidir o que fazer (o loop do agente reexecuta).
 */
export async function* gerarStream(opts: OpcoesChamada): AsyncGenerator<PedacoStream> {
  const url = `${BASE}/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${opts.apiKey}`
  const { res, liberar } = await comRetentativas(url, opts, true)

  if (!res.body) {
    liberar()
    // Sem corpo legível: cai para a versão não-streaming em vez de falhar.
    const rodada = await gerarRodada(opts)
    if (rodada.chamadas.length > 0) yield { tipo: 'chamadas', chamadas: rodada.chamadas }
    if (rodada.texto) yield { tipo: 'texto', texto: rodada.texto }
    yield { tipo: 'fim', finishReason: rodada.finishReason }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | undefined
  const chamadasAcumuladas: ChamadaFerramenta[] = []

  try {
    while (true) {
      if (Date.now() >= opts.deadlineMs) break
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const linhas = buffer.split('\n')
      buffer = linhas.pop() ?? ''

      for (const linha of linhas) {
        if (!linha.startsWith('data:')) continue
        const payload = linha.slice(5).trim()
        if (!payload || payload === '[DONE]') continue

        let json: { candidates?: unknown[] }
        try { json = JSON.parse(payload) } catch { continue }

        const rodada = extrairRodada(json.candidates?.[0])
        if (rodada.finishReason) finishReason = rodada.finishReason
        if (rodada.chamadas.length > 0) chamadasAcumuladas.push(...rodada.chamadas)
        if (rodada.texto) yield { tipo: 'texto', texto: rodada.texto }
      }
    }
  } finally {
    liberar()
    try { await reader.cancel() } catch { /* stream já encerrado */ }
  }

  if (chamadasAcumuladas.length > 0) yield { tipo: 'chamadas', chamadas: chamadasAcumuladas }
  yield { tipo: 'fim', finishReason }
}

// ─── Resumo de conversa longa ────────────────────────────────────────────────

export async function resumirConversa(
  apiKey: string,
  mensagens: Array<{ role: string; content: string }>,
  deadlineMs: number
): Promise<string | null> {
  const texto = mensagens
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
    .join('\n\n')
    .slice(0, 24_000)

  try {
    const rodada = await gerarRodada({
      apiKey,
      deadlineMs,
      temperature: 0.2,
      maxOutputTokens: 800,
      contents: [{
        role: 'user',
        parts: [{
          text:
            'Resuma em no máximo 200 palavras esta conversa sobre finanças pessoais, preservando todos os valores ' +
            `numéricos, períodos citados e conclusões. Escreva apenas o resumo.\n\n${texto}`,
        }],
      }],
    })
    return rodada.texto.trim() || null
  } catch {
    // Resumir é otimização, não requisito: falhar aqui não pode derrubar o turno.
    return null
  }
}
