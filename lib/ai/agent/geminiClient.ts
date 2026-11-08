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

/**
 * Modelo do assistente (chat do app, Telegram, resumo e transcrição).
 * GEMINI_MODEL_CHAT no ambiente troca sem mudar código — inclusive para
 * voltar ao anterior se o novo se comportar mal.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL_CHAT?.trim() || 'gemini-3.8-flash'
/** Modelo das rotinas que ainda não migraram (análise de comportamento). */
export const GEMINI_MODEL_LEGADO = 'gemini-2.5-flash'
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// ─── Tipos do protocolo ──────────────────────────────────────────────────────

export interface GeminiPart {
  text?: string
  /** Mídia embutida em base64 (ex.: áudio de voz do Telegram para transcrever). */
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  /**
   * Assinatura do raciocínio (família Gemini 3). Vem na parte da chamada de
   * ferramenta e PRECISA voltar na mesma parte na rodada seguinte — sem ela a
   * API recusa a requisição.
   */
  thoughtSignature?: string
}

export interface GeminiContent {
  role: 'user' | 'model' | 'function'
  parts: GeminiPart[]
}

export interface ChamadaFerramenta {
  name: string
  args: Record<string, unknown>
  /** thoughtSignature recebida com a chamada — devolvida intacta ao modelo. */
  assinatura?: string
}

/** Tokens gastos numa chamada (usageMetadata do Gemini). */
export interface UsoTokens {
  entrada: number
  saida: number
  raciocinio: number
}

export function somarUso(a: UsoTokens | undefined, b: UsoTokens | undefined): UsoTokens {
  return {
    entrada: (a?.entrada ?? 0) + (b?.entrada ?? 0),
    saida: (a?.saida ?? 0) + (b?.saida ?? 0),
    raciocinio: (a?.raciocinio ?? 0) + (b?.raciocinio ?? 0),
  }
}

function lerUso(json: unknown): UsoTokens | undefined {
  const u = (json as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata
  if (!u) return undefined
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { entrada: n(u.promptTokenCount), saida: n(u.candidatesTokenCount), raciocinio: n(u.thoughtsTokenCount) }
}

/** Resultado de uma rodada: ou o modelo pediu ferramentas, ou produziu texto. */
export interface RodadaGemini {
  texto: string
  chamadas: ChamadaFerramenta[]
  finishReason?: string
  uso?: UsoTokens
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly codigo: 'QUOTA' | 'CREDITOS' | 'OVERLOADED' | 'TIMEOUT' | 'CONFIG' | 'DESCONHECIDO',
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
  // Créditos pré-pagos do projeto esgotados: só volta quando houver recarga no
  // AI Studio. Sem isto o 402 era retentado e terminava como "TIMEOUT".
  if (status === 402) {
    return new GeminiError(`Créditos do Gemini esgotados: ${corpo.slice(0, 300)}`, 'CREDITOS')
  }
  // Erros definitivos de cliente não devem ser retentados.
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return new GeminiError(`Gemini rejeitou a requisição (${status}): ${corpo.slice(0, 300)}`, 'CONFIG')
  }
  return null
}

export interface OpcoesChamada {
  apiKey: string
  contents: GeminiContent[]
  systemInstruction?: string
  tools?: FunctionDeclaration[]
  deadlineMs: number
  temperature?: number
  maxOutputTokens?: number
  /** Tokens de raciocínio interno. 0 desliga (tarefas mecânicas, como resumir). */
  thinkingBudget?: number
  /** Modelo desta chamada (padrão: GEMINI_MODEL). */
  modelo?: string
  /**
   * 'NONE' mantém as ferramentas declaradas mas proíbe chamá-las — o jeito de
   * forçar a resposta em texto. Tirar as ferramentas de uma conversa que já
   * tem chamadas fazia o Gemini 3 devolver vazio.
   */
  modoFerramentas?: 'AUTO' | 'NONE'
  /** 'application/json' força a resposta em JSON (sem ferramentas). */
  responseMimeType?: string
  /** Esquema (subconjunto OpenAPI) que a resposta JSON deve seguir. */
  responseSchema?: Record<string, unknown>
}

// No Gemini 2.5 o raciocínio interno ("thinking") conta dentro de
// maxOutputTokens. Com o orçamento dinâmico padrão e teto de 4096, uma pergunta
// difícil podia gastar quase tudo pensando e devolver a resposta cortada — ou
// vazia. Agora o raciocínio tem teto próprio e a resposta tem folga.
const ORCAMENTO_RACIOCINIO = 2048
const TETO_SAIDA = 8192
/** Na família 3 o nível de raciocínio não tem teto em tokens: mais folga para a resposta. */
const TETO_SAIDA_GEMINI3 = 16384

const ehGemini3 = (modelo: string) => /^gemini-3/.test(modelo)

/**
 * A família Gemini 3 troca o orçamento em tokens por um nível de raciocínio
 * (mandar os dois é erro). Mantemos a mesma régua para quem chama: 0 =
 * mecânico (resumir, transcrever), o padrão do agente = médio.
 */
function nivelRaciocinio(orcamento: number): 'minimal' | 'low' | 'medium' | 'high' {
  if (orcamento <= 0) return 'minimal'
  if (orcamento <= 1024) return 'low'
  if (orcamento <= 8192) return 'medium'
  return 'high'
}

function configGeracao(opts: OpcoesChamada): Record<string, unknown> {
  const modelo = opts.modelo ?? GEMINI_MODEL
  const orcamento = opts.thinkingBudget ?? ORCAMENTO_RACIOCINIO
  const formato = {
    ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
    ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
  }
  if (ehGemini3(modelo)) {
    // Sem temperature: o Google recomenda o padrão (1.0) na família 3 —
    // temperaturas baixas podem fazer o modelo entrar em repetição.
    return {
      maxOutputTokens: opts.maxOutputTokens ?? TETO_SAIDA_GEMINI3,
      thinkingConfig: { thinkingLevel: nivelRaciocinio(orcamento) },
      ...formato,
    }
  }
  return {
    // Baixa: a tarefa é ler números e explicá-los, não criar texto variado.
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? TETO_SAIDA,
    thinkingConfig: { thinkingBudget: orcamento },
    ...formato,
  }
}

function montarCorpo(opts: OpcoesChamada): string {
  return JSON.stringify({
    contents: opts.contents,
    ...(opts.systemInstruction
      ? { systemInstruction: { role: 'user', parts: [{ text: opts.systemInstruction }] } }
      : {}),
    ...(opts.tools && opts.tools.length > 0
      ? { tools: [{ functionDeclarations: opts.tools }], toolConfig: { functionCallingConfig: { mode: opts.modoFerramentas ?? 'AUTO' } } }
      : {}),
    generationConfig: configGeracao(opts),
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
      chamadas.push({
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
        ...(p.thoughtSignature ? { assinatura: p.thoughtSignature } : {}),
      })
    } else if (typeof p.text === 'string') {
      texto += p.text
    }
  }

  return { texto, chamadas, finishReason: c?.finishReason }
}

// ─── Chamada não-streaming (rodadas de raciocínio/ferramenta) ────────────────

export async function gerarRodada(opts: OpcoesChamada): Promise<RodadaGemini> {
  const url = `${BASE}/${opts.modelo ?? GEMINI_MODEL}:generateContent?key=${opts.apiKey}`
  const { res } = await comRetentativas(url, opts, false)
  const json = await res.json()
  return { ...extrairRodada(json.candidates?.[0]), uso: lerUso(json) }
}

// ─── Chamada com streaming (resposta final ao usuário) ───────────────────────

export interface PedacoStream {
  tipo: 'texto' | 'chamadas' | 'fim'
  texto?: string
  chamadas?: ChamadaFerramenta[]
  finishReason?: string
  /** Só no pedaço 'fim'. */
  uso?: UsoTokens
}

/**
 * Consome `streamGenerateContent?alt=sse` e emite pedaços conforme chegam.
 * Se o modelo decidir chamar uma ferramenta no meio do stream, emitimos as
 * chamadas para o chamador decidir o que fazer (o loop do agente reexecuta).
 */
export async function* gerarStream(opts: OpcoesChamada): AsyncGenerator<PedacoStream> {
  const url = `${BASE}/${opts.modelo ?? GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${opts.apiKey}`
  const { res, liberar } = await comRetentativas(url, opts, true)

  if (!res.body) {
    liberar()
    // Sem corpo legível: cai para a versão não-streaming em vez de falhar.
    const rodada = await gerarRodada(opts)
    if (rodada.chamadas.length > 0) yield { tipo: 'chamadas', chamadas: rodada.chamadas }
    if (rodada.texto) yield { tipo: 'texto', texto: rodada.texto }
    yield { tipo: 'fim', finishReason: rodada.finishReason, uso: rodada.uso }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | undefined
  // O Gemini repete usageMetadata nos pedaços; o último é o total da chamada.
  let uso: UsoTokens | undefined
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
        uso = lerUso(json) ?? uso

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
  yield { tipo: 'fim', finishReason, uso }
}

// ─── Resumo de conversa longa ────────────────────────────────────────────────

export async function resumirConversa(
  apiKey: string,
  mensagens: Array<{ role: string; content: string }>,
  deadlineMs: number,
  resumoAnterior?: string
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
      maxOutputTokens: 1000,
      thinkingBudget: 0,
      contents: [{
        role: 'user',
        parts: [{
          text:
            'Resuma em no máximo 250 palavras esta conversa sobre finanças pessoais, preservando os valores ' +
            'numéricos, os períodos citados, as conclusões e o que o usuário quer acompanhar. Se o assistente foi ' +
            'corrigido em algum ponto, registre só o valor corrigido. Escreva apenas o resumo.' +
            (resumoAnterior ? `\n\nResumo do trecho anterior (incorpore-o):\n${resumoAnterior.slice(0, 4000)}` : '') +
            `\n\nConversa:\n${texto}`,
        }],
      }],
    })
    return rodada.texto.trim() || null
  } catch {
    // Resumir é otimização, não requisito: falhar aqui não pode derrubar o turno.
    return null
  }
}

// ─── Transcrição de áudio ────────────────────────────────────────────────────

/**
 * Transcreve uma mensagem de voz (o Gemini aceita áudio embutido). Devolve
 * null se não houver fala inteligível — o chamador pede para a pessoa repetir
 * em vez de mandar ruído para o agente.
 */
export async function transcreverAudio(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
  deadlineMs: number
): Promise<string | null> {
  const rodada = await gerarRodada({
    apiKey,
    deadlineMs,
    temperature: 0,
    maxOutputTokens: 1500,
    thinkingBudget: 0,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        {
          text:
            'Transcreva literalmente, em português, o que a pessoa fala neste áudio. Escreva valores em reais ' +
            'com algarismos (ex.: "R$ 120,50"). Devolva apenas a transcrição, sem comentários. Se não houver fala ' +
            'inteligível, devolva exatamente: [INAUDIVEL]',
        },
      ],
    }],
  })
  const texto = rodada.texto.trim()
  if (!texto || texto.includes('[INAUDIVEL]')) return null
  return texto
}
