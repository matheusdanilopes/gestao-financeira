/**
 * Contingência da IA: Groq (API compatível com a da OpenAI), usado quando o
 * Gemini falha — cota, créditos esgotados, sobrecarga, tempo ou modelo
 * aposentado. Mesmo desenho do HealthCoach (src/lib/groq.ts).
 *
 * As requisições chegam no formato do Gemini (contents/parts, ferramentas com
 * tipos em maiúsculas, responseSchema) e são traduzidas aqui — quem chama o
 * geminiClient não precisa saber que a resposta veio de outro provedor.
 *
 * GROQ_API_KEY habilita a contingência; GROQ_MODEL (opcional) é o primeiro
 * modelo tentado.
 */

import type { FunctionDeclaration } from './tools'
import type {
  ChamadaFerramenta,
  GeminiContent,
  OpcoesChamada,
  RodadaGemini,
} from './geminiClient'

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

// O Groq aposenta modelos com frequência e um ID fixo derrubava a contingência
// inteira. Os candidatos são tentados em ordem até um existir; o primeiro que
// responde fica guardado para as próximas chamadas.
const MODELOS_VISAO = ['qwen/qwen3.8-27b', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct']
const MODELOS_TEXTO = ['qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
const MODELOS_AUDIO = ['whisper-large-v3-turbo', 'whisper-large-v3']
let modeloVisaoOk: string | null = null
let modeloTextoOk: string | null = null
let modeloAudioOk: string | null = null

/** Teto por tentativa, para uma requisição travada não segurar a função. */
const TIMEOUT_TENTATIVA_MS = 30_000
const MAX_TENTATIVAS = 2
const STATUS_RETENTAVEL = new Set([429, 500, 502, 503, 504])

export function groqConfigurado(): boolean {
  return !!process.env.GROQ_API_KEY?.trim()
}

function candidatos(lista: string[], cache: string | null, doAmbiente = true): string[] {
  const todos = [doAmbiente ? process.env.GROQ_MODEL?.trim() : undefined, cache, ...lista]
  return [...new Set(todos.filter((m): m is string => !!m))]
}

// Modelos de raciocínio gastam max_tokens num "pensamento" oculto antes da
// resposta, o que pode cortar o JSON. Cada família tem o seu controle.
function parametrosRaciocinio(modelo: string): Record<string, string> {
  if (/qwen3/i.test(modelo)) return { reasoning_effort: 'none' }
  if (/gpt-oss/i.test(modelo)) return { reasoning_effort: 'low' }
  return {}
}

function modeloIndisponivel(status: number, corpo: string): boolean {
  return status === 404 || /model_not_found|model_decommissioned|does not exist|decommissioned/i.test(corpo)
}

class ModeloIndisponivelError extends Error {}

// ─── Tradução Gemini → OpenAI ────────────────────────────────────────────────

/** Esquema do Gemini (type: 'OBJECT', nullable…) → JSON Schema (type: 'object'). */
export function converterEsquema(esquema: unknown): unknown {
  if (Array.isArray(esquema)) return esquema.map(converterEsquema)
  if (!esquema || typeof esquema !== 'object') return esquema
  const saida: Record<string, unknown> = {}
  const origem = esquema as Record<string, unknown>
  for (const [chave, valor] of Object.entries(origem)) {
    if (chave === 'nullable') continue
    if (chave === 'type' && typeof valor === 'string') {
      const tipo = valor.toLowerCase()
      saida.type = origem.nullable === true ? [tipo, 'null'] : tipo
    } else if (chave === 'properties' && valor && typeof valor === 'object') {
      saida.properties = Object.fromEntries(
        Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, converterEsquema(v)])
      )
    } else {
      saida[chave] = converterEsquema(valor)
    }
  }
  return saida
}

type ConteudoUsuario = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

type MensagemOpenAI =
  | { role: 'system'; content: string }
  | { role: 'user'; content: ConteudoUsuario }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

function instrucaoJson(opts: OpcoesChamada): string {
  if (opts.responseMimeType !== 'application/json') return ''
  return '\n\nResponda SOMENTE com um objeto JSON válido, sem markdown nem texto fora dele.' +
    (opts.responseSchema ? `\nO JSON deve seguir este esquema (JSON Schema):\n${JSON.stringify(converterEsquema(opts.responseSchema))}` : '')
}

/**
 * Converte a conversa. As chamadas de ferramenta do Gemini não têm id; aqui
 * cada uma ganha um, e a resposta da ferramenta é casada pela ordem e pelo nome.
 */
export function converterMensagens(opts: OpcoesChamada): { mensagens: MensagemOpenAI[]; temImagem: boolean } {
  const mensagens: MensagemOpenAI[] = []
  let temImagem = false
  const sistema = (opts.systemInstruction ?? '') + instrucaoJson(opts)
  if (sistema.trim()) mensagens.push({ role: 'system', content: sistema.trim() })

  let seq = 0
  const pendentes: Array<{ id: string; nome: string }> = []

  for (const c of opts.contents as GeminiContent[]) {
    if (c.role === 'model') {
      const texto = c.parts.map(p => p.text ?? '').join('')
      const chamadas = c.parts.filter(p => p.functionCall?.name)
      const toolCalls = chamadas.map(p => {
        const id = `call_${++seq}`
        pendentes.push({ id, nome: p.functionCall!.name })
        return {
          id,
          type: 'function' as const,
          function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
        }
      })
      if (!texto && toolCalls.length === 0) continue
      mensagens.push({ role: 'assistant', content: texto || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
      continue
    }

    const conteudo: Exclude<ConteudoUsuario, string> = []
    for (const p of c.parts) {
      if (p.functionResponse) {
        const i = pendentes.findIndex(x => x.nome === p.functionResponse!.name)
        const id = i >= 0 ? pendentes.splice(i, 1)[0].id : `call_${++seq}`
        const resposta = p.functionResponse.response
        const texto = typeof resposta?.content === 'string' ? resposta.content : JSON.stringify(resposta ?? {})
        mensagens.push({ role: 'tool', tool_call_id: id, content: texto })
      } else if (p.inlineData) {
        if (!p.inlineData.mimeType.startsWith('image/')) {
          throw new Error(`Groq não aceita mídia ${p.inlineData.mimeType} no chat`)
        }
        temImagem = true
        conteudo.push({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } })
      } else if (typeof p.text === 'string' && p.text) {
        conteudo.push({ type: 'text', text: p.text })
      }
    }
    if (conteudo.length === 0) continue
    const soTexto = conteudo.every(x => x.type === 'text')
    mensagens.push({
      role: 'user',
      content: soTexto ? conteudo.map(x => (x as { text: string }).text).join('\n\n') : conteudo,
    })
  }

  return { mensagens, temImagem }
}

function converterFerramentas(tools: FunctionDeclaration[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: converterEsquema(t.parameters) },
  }))
}

/** Alguns modelos devolvem o raciocínio entre <think>…</think> no próprio texto. */
function limparTexto(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '').trimStart()
}

function traduzirFim(motivo: unknown): string | undefined {
  if (motivo === 'length') return 'MAX_TOKENS'
  if (motivo === 'stop' || motivo === 'tool_calls') return 'STOP'
  return typeof motivo === 'string' ? motivo.toUpperCase() : undefined
}

// ─── Chamada ─────────────────────────────────────────────────────────────────

const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Uma rodada no Groq, no mesmo formato de `gerarRodada` do Gemini. Lança erro
 * se não houver chave, tempo ou modelo disponível.
 */
export async function gerarRodadaGroq(opts: OpcoesChamada): Promise<RodadaGemini> {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada')

  const { mensagens, temImagem } = converterMensagens(opts)
  const lista = temImagem
    ? candidatos(MODELOS_VISAO, modeloVisaoOk)
    : candidatos(MODELOS_TEXTO, modeloTextoOk)

  let ultimoErro: unknown = null
  for (const modelo of lista) {
    try {
      const rodada = await chamarModelo(modelo, apiKey, mensagens, opts)
      if (temImagem) modeloVisaoOk = modelo
      else modeloTextoOk = modelo
      return rodada
    } catch (err) {
      ultimoErro = err
      if (!(err instanceof ModeloIndisponivelError)) throw err
      console.warn(`[groq] Modelo ${modelo} indisponível, tentando o próximo`)
    }
  }
  throw ultimoErro ?? new Error('Nenhum modelo do Groq disponível')
}

async function chamarModelo(
  modelo: string,
  apiKey: string,
  mensagens: MensagemOpenAI[],
  opts: OpcoesChamada
): Promise<RodadaGemini> {
  const ferramentas = opts.tools && opts.tools.length > 0 ? converterFerramentas(opts.tools) : null
  const corpo = JSON.stringify({
    model: modelo,
    messages: mensagens,
    temperature: opts.temperature ?? 0.3,
    // O teto do Gemini 3 (16k) passa do limite de vários modelos do Groq.
    max_completion_tokens: Math.min(opts.maxOutputTokens ?? 4096, 8192),
    ...(ferramentas ? { tools: ferramentas, tool_choice: opts.modoFerramentas === 'NONE' ? 'none' : 'auto' } : {}),
    ...(opts.responseMimeType === 'application/json' && !ferramentas ? { response_format: { type: 'json_object' } } : {}),
    ...parametrosRaciocinio(modelo),
  })

  let atraso = 500
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const restante = opts.deadlineMs - Date.now()
    if (restante < 1_500) throw new Error('Groq: sem tempo restante no turno')

    let res: Response
    try {
      res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(Math.min(TIMEOUT_TENTATIVA_MS, restante)),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: corpo,
      })
    } catch (err) {
      // Falha de rede ou timeout — retenta como um 5xx.
      if (tentativa === MAX_TENTATIVAS) throw err
      await espera(atraso)
      atraso *= 2
      continue
    }

    if (res.ok) {
      const json = await res.json()
      const escolha = json?.choices?.[0]
      const msg = escolha?.message ?? {}
      const chamadas: ChamadaFerramenta[] = []
      for (const tc of (msg.tool_calls ?? []) as Array<{ function?: { name?: string; arguments?: string } }>) {
        if (!tc.function?.name) continue
        let args: Record<string, unknown> = {}
        try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {} } catch { /* args vazios */ }
        chamadas.push({ name: tc.function.name, args })
      }
      const texto = typeof msg.content === 'string' ? limparTexto(msg.content) : ''
      if (!texto && chamadas.length === 0) throw new Error(`Resposta vazia do Groq (${modelo})`)
      const u = json?.usage ?? {}
      return {
        texto,
        chamadas,
        finishReason: traduzirFim(escolha?.finish_reason),
        uso: { entrada: Number(u.prompt_tokens) || 0, saida: Number(u.completion_tokens) || 0, raciocinio: 0 },
        modelo: `groq:${modelo}`,
      }
    }

    const erroCorpo = await res.text().catch(() => '')
    const mensagem = `Groq HTTP ${res.status} (${modelo}): ${erroCorpo.slice(0, 300)}`
    if (modeloIndisponivel(res.status, erroCorpo)) throw new ModeloIndisponivelError(mensagem)
    // tool_use_failed: o modelo gerou uma chamada de ferramenta malformada — vale repetir.
    const retentavel = STATUS_RETENTAVEL.has(res.status) || /tool_use_failed/.test(erroCorpo)
    if (tentativa === MAX_TENTATIVAS || !retentavel) throw new Error(mensagem)
    await espera(atraso)
    atraso *= 2
  }

  throw new Error('Groq: retentativas esgotadas')
}

// ─── Transcrição de áudio (Whisper) ──────────────────────────────────────────

const EXTENSOES: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/oga': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/webm': 'webm', 'audio/flac': 'flac',
}

/** Transcreve áudio pelo Whisper do Groq. Devolve null se não houver fala. */
export async function transcreverAudioGroq(
  audioBase64: string,
  mimeType: string,
  deadlineMs: number
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada')

  const tipo = mimeType.split(';')[0].trim().toLowerCase()
  const nome = `audio.${EXTENSOES[tipo] ?? 'ogg'}`
  const bytes = Buffer.from(audioBase64, 'base64')

  let ultimoErro: unknown = null
  for (const modelo of candidatos(MODELOS_AUDIO, modeloAudioOk, false)) {
    const restante = deadlineMs - Date.now()
    if (restante < 1_500) break
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: tipo || 'audio/ogg' }), nome)
    form.append('model', modelo)
    form.append('language', 'pt')
    form.append('response_format', 'json')
    form.append('temperature', '0')

    const res = await fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(Math.min(TIMEOUT_TENTATIVA_MS, restante)),
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (res.ok) {
      const json = await res.json()
      modeloAudioOk = modelo
      const texto = typeof json?.text === 'string' ? json.text.trim() : ''
      return texto || null
    }
    const corpo = await res.text().catch(() => '')
    ultimoErro = new Error(`Groq Whisper HTTP ${res.status} (${modelo}): ${corpo.slice(0, 300)}`)
    if (!modeloIndisponivel(res.status, corpo)) throw ultimoErro
    console.warn(`[groq] Modelo ${modelo} indisponível, tentando o próximo`)
  }
  throw ultimoErro ?? new Error('Groq Whisper: sem tempo restante')
}
