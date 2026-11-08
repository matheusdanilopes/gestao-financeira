/**
 * Apoio dos testes do agente: Gemini simulado (fetch falso, com streaming em
 * pedaços e erros HTTP), Supabase em memória e um gateway de dados falso.
 * Nada aqui toca rede ou banco de verdade.
 */
import assert from 'node:assert/strict'
import { executarAgente, type AgentEvent } from '../runAgent'
import { construirReferencias } from '../queryEngine'
import type { GatewayDados } from '../../data/gateway'
import type { ContextoEscrita } from '../writeEngine'
import type { EnrichedData } from '../../types'

export type Parte = Record<string, unknown>

/** Resposta simulada a UMA chamada ao Gemini. */
export type RespostaSimulada =
  | Parte[]
  | { pedacos: Parte[][]; finishReason?: string }
  | { status: number; corpo?: string }

export interface CorpoEnviado {
  url: string
  contents: Array<{ role: string; parts: Parte[] }>
  tools?: Array<{ functionDeclarations: Array<{ name: string }> }>
  generationConfig: Record<string, unknown>
  systemInstruction?: { parts: Array<{ text: string }> }
}

const fetchOriginal = globalThis.fetch
export function restaurarFetch() { globalThis.fetch = fetchOriginal }

/**
 * Substitui o fetch: cada chamada consome a próxima resposta da lista (a
 * última se repete). Devolve os corpos enviados, para inspecionar o que o
 * agente mandou ao modelo.
 */
export function simularGemini(respostas: RespostaSimulada[]): CorpoEnviado[] {
  const enviados: CorpoEnviado[] = []
  let i = 0
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    enviados.push({ url: String(url), ...JSON.parse(String(init?.body)) })
    const r = respostas[Math.min(i++, respostas.length - 1)]
    if (!Array.isArray(r) && 'status' in r) {
      return new Response(r.corpo ?? '{}', { status: r.status })
    }
    const pedacos = Array.isArray(r) ? [r] : r.pedacos
    const finishReason = Array.isArray(r) ? 'STOP' : r.finishReason ?? 'STOP'
    const linhas = pedacos.map((parts, k) => {
      const ultimo = k === pedacos.length - 1
      const chunk = {
        candidates: [{ content: { parts }, ...(ultimo ? { finishReason } : {}) }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
      }
      return `data: ${JSON.stringify(chunk)}\n\n`
    })
    // generateContent (sem stream) recebe JSON simples com todas as partes.
    if (!String(url).includes('streamGenerateContent')) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: pedacos.flat() }, finishReason }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
      }), { status: 200 })
    }
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of linhas) c.enqueue(new TextEncoder().encode(l))
        c.close()
      },
    })
    return new Response(body, { status: 200 })
  }) as typeof fetch
  return enviados
}

// ─── Supabase em memória ─────────────────────────────────────────────────────

type Linha = Record<string, unknown>

/**
 * Subconjunto do query builder do supabase-js usado pelo writeEngine:
 * select/insert/update/upsert + eq/neq/order/limit/maybeSingle/single.
 */
export function criarSupabaseFalso(inicial: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = {}
  for (const [k, v] of Object.entries(inicial)) tabelas[k] = v.map(l => ({ ...l }))
  let seq = 0

  function consulta(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = []
    let operacao: 'select' | 'insert' | 'update' = 'select'
    let valores: Linha | Linha[] | null = null
    let ordem: { coluna: string; asc: boolean } | null = null
    let limite: number | null = null
    let faixa: [number, number] | null = null
    let unico: 'maybe' | 'single' | null = null

    const linhas = () => (tabelas[tabela] ??= [])
    const executar = () => {
      if (operacao === 'insert') {
        const novas = (Array.isArray(valores) ? valores : [valores!]).map(v => ({
          id: `id-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), status: 'pendente', ...v,
        }))
        linhas().push(...novas)
        return { data: novas, error: null }
      }
      let sel = linhas().filter(l => filtros.every(f => f(l)))
      if (operacao === 'update') {
        for (const l of sel) Object.assign(l, valores)
        return { data: sel, error: null }
      }
      if (ordem) {
        const { coluna, asc } = ordem
        sel = [...sel].sort((a, b) => (String(a[coluna]) < String(b[coluna]) ? -1 : 1) * (asc ? 1 : -1))
      }
      if (faixa) sel = sel.slice(faixa[0], faixa[1] + 1)
      if (limite !== null) sel = sel.slice(0, limite)
      if (unico) return { data: sel[0] ?? null, error: null }
      return { data: sel, error: null }
    }

    const builder = {
      select: () => builder,
      insert: (v: Linha | Linha[]) => { operacao = 'insert'; valores = v; return builder },
      upsert: (v: Linha | Linha[]) => { operacao = 'insert'; valores = v; return builder },
      update: (v: Linha) => { operacao = 'update'; valores = v; return builder },
      eq: (c: string, v: unknown) => { filtros.push(l => l[c] === v); return builder },
      neq: (c: string, v: unknown) => { filtros.push(l => l[c] !== v); return builder },
      in: (c: string, vs: unknown[]) => { filtros.push(l => vs.includes(l[c])); return builder },
      is: (c: string, v: null) => { filtros.push(l => (l[c] ?? null) === v); return builder },
      gt: (c: string, v: number) => { filtros.push(l => Number(l[c]) > v); return builder },
      not: (c: string, op: string, v: unknown) => {
        filtros.push(l => (op === 'is' ? (l[c] ?? null) !== v : l[c] !== v))
        return builder
      },
      ilike: (c: string, padrao: string) => {
        const re = new RegExp('^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
        filtros.push(l => re.test(String(l[c] ?? '')))
        return builder
      },
      // "col.is.null,col.eq.valor" — qualquer uma das condições.
      or: (expr: string) => {
        const conds = expr.split(',').map(c => {
          const [col, op, ...resto] = c.split('.')
          const v = resto.join('.')
          return (l: Linha) => (op === 'is' && v === 'null' ? (l[col] ?? null) === null : String(l[col]) === v)
        })
        filtros.push(l => conds.some(f => f(l)))
        return builder
      },
      range: (de: number, ate: number) => { faixa = [de, ate]; return builder },
      order: (coluna: string, o?: { ascending?: boolean }) => { ordem = { coluna, asc: o?.ascending !== false }; return builder },
      limit: (n: number) => { limite = n; return builder },
      maybeSingle: () => { unico = 'maybe'; return Promise.resolve(executar()) },
      single: () => { unico = 'single'; return Promise.resolve(executar()) },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    }
    return builder
  }

  return { tabelas, cliente: { from: consulta } }
}

// ─── Dados e gateway falsos ──────────────────────────────────────────────────

export function dadosVazios(extra: Partial<Record<keyof EnrichedData, unknown>> = {}): EnrichedData {
  return {
    transacoes: [], planejamento: [], assinaturas: [], receitas: [], investimentos: [], aportes: [],
    configuracoes: [], faturas: [], mercado: [], desejos: [],
    ...extra,
  } as unknown as EnrichedData
}

export function gatewayFalso(dados: EnrichedData = dadosVazios()): GatewayDados {
  return {
    dados: async () => dados,
    garantirDesde: async () => {},
    garantirTudo: async () => {},
    invalidar: () => {},
    cobertura: { completo: true },
  } as unknown as GatewayDados
}

export const HOJE_TESTE = new Date(2026, 10, 3) // 03/11/2026

export interface OpcoesRodar {
  historico?: Array<{ role: string; content: string }>
  systemPrompt?: string
  dados?: EnrichedData
  escrita?: Partial<ContextoEscrita>
  deadlineMs?: number
  semFerramentas?: boolean
}

/** Roda um turno do agente e devolve todos os eventos e o 'done'. */
export async function rodarTurno(pergunta: string, o: OpcoesRodar = {}) {
  const eventos: AgentEvent[] = []
  for await (const e of executarAgente({
    apiKey: 'teste',
    systemPrompt: o.systemPrompt ?? 'SNAPSHOT: Total do mês R$ 1.000,00',
    historico: o.historico ?? [],
    pergunta,
    gateway: gatewayFalso(o.dados),
    refs: construirReferencias(HOJE_TESTE),
    semFerramentas: o.semFerramentas,
    deadlineMs: o.deadlineMs ?? Date.now() + 60_000,
    escrita: { conversationId: 'conv-1', usuario: 'teste@financeiro.com', responsavelPadrao: 'Jeniffer', ...o.escrita } as ContextoEscrita,
  })) eventos.push(e)
  const done = eventos.find(e => e.type === 'done')
  assert.ok(done && done.type === 'done', 'o turno precisa terminar com done')
  return { eventos, done }
}

/** Partes de texto e de chamada, para montar respostas simuladas com menos ruído. */
export const texto = (t: string): Parte => ({ text: t })
export const chamada = (name: string, args: Record<string, unknown> = {}, assinatura?: string): Parte => ({
  functionCall: { name, args },
  ...(assinatura ? { thoughtSignature: assinatura } : {}),
})
