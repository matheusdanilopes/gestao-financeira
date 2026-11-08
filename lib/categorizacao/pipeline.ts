/**
 * Decide a categoria de cada compra, da fonte mais confiável para a menos:
 *
 *   1. PARCELA   — outra parcela da MESMA compra já categorizada (36 de 298
 *                  compras parceladas tinham categorias diferentes por parcela)
 *   2. HISTORICO — o que o casal já escolheu para esse estabelecimento
 *   3. REGRA     — estabelecimento inequívoco (Uber, iFood, farmácia…)
 *   4. IA        — o resto, com contexto e exemplos do casal
 *
 * Função sem banco: recebe tudo pronto e devolve as decisões. A gravação fica
 * em lib/categorizarTransacoes.ts — assim cada etapa é testável isolada.
 */
import { GeminiError } from '../ai/agent/geminiClient'
import { normalizarEstabelecimento, DESCRICAO_ADQUIRENTE, type Estabelecimento } from './normalizacao'
import { aplicarRegras } from './regras'
import type { MemoriaCategorias } from './memoria'
import { classificarLoteIA, type ItemParaIA, type OpcoesIA } from './ia'

export interface TransacaoParaCategorizar {
  hash_linha: string
  descricao: string
  descricao_personalizada?: string | null
  valor: number
  parcela_atual?: number | null
  total_parcelas?: number | null
  responsavel?: string | null
}

/** Compra já categorizada que pode ser outra parcela da mesma compra. */
export interface CompraCategorizada {
  descricao: string
  total_parcelas?: number | null
  valor: number
  responsavel?: string | null
  categoria: string | null
  categoria_origem?: string | null
}

export type OrigemDecisao = 'PARCELA' | 'HISTORICO' | 'REGRA' | 'IA'

export interface Decisao {
  hash_linha: string
  categoria: string
  origem: OrigemDecisao
  confianca: number
  /** revisao_pendente = vale o casal conferir (palpite fraco ou "Outros"). */
  status: 'automatico' | 'revisao_pendente'
  motivo: string
}

export interface ResultadoPipeline {
  decisoes: Decisao[]
  /** Ficaram sem decisão (IA falhou, cota, prazo) — continuam sem categoria. */
  semDecisao: string[]
  erros: string[]
  cotaDiariaEsgotada: boolean
  chamadasIA: number
}

export interface ContextoPipeline {
  permitidas: string[]
  memoria: MemoriaCategorias
  categorizadas: CompraCategorizada[]
  ia?: OpcoesIA & {
    tamanhoLote?: number
    pausaEntreLotesMs?: number
  }
  aoProgresso?: (feitas: number, total: number) => void
}

const CONFIANCA_MINIMA_IA = 0.6
const ORIGENS_HUMANAS = new Set(['MANUAL', 'USUARIO'])

const mesmaCompra = (a: { chave: string; total: number; resp: string; valor: number }, b: typeof a) =>
  a.chave === b.chave && a.total === b.total && a.resp === b.resp &&
  Math.abs(Math.abs(a.valor) - Math.abs(b.valor)) <= Math.max(0.1, Math.abs(a.valor) * 0.02)

interface Grupo {
  chave: string
  total: number
  resp: string
  valor: number
  est: Estabelecimento
  representante: TransacaoParaCategorizar
  membros: TransacaoParaCategorizar[]
}

function agrupar(transacoes: TransacaoParaCategorizar[]): Grupo[] {
  const grupos: Grupo[] = []
  for (const t of transacoes) {
    const est = normalizarEstabelecimento(t.descricao)
    const total = t.total_parcelas && t.total_parcelas > 1 ? t.total_parcelas : 0
    const id = { chave: est.chave, total, resp: t.responsavel ?? '', valor: Number(t.valor) || 0 }
    // Só parcelas se agrupam: duas compras avulsas na mesma loja podem ser coisas diferentes.
    const existente = total > 0 ? grupos.find(g => g.total > 0 && mesmaCompra(g, id)) : undefined
    if (existente) {
      existente.membros.push(t)
      // O nome dado pelo casal em qualquer parcela vale para a compra toda.
      if (!existente.representante.descricao_personalizada && t.descricao_personalizada) existente.representante = t
    } else {
      grupos.push({ ...id, est, representante: t, membros: [t] })
    }
  }
  return grupos
}

function decidirPorParcela(g: Grupo, categorizadas: CompraCategorizada[], permitidas: string[]) {
  if (g.total === 0) return null
  const irmas = categorizadas.filter(c => {
    if (!c.categoria || c.categoria === 'Outros' || !permitidas.includes(c.categoria)) return false
    const est = normalizarEstabelecimento(c.descricao)
    return mesmaCompra(g, { chave: est.chave, total: c.total_parcelas ?? 0, resp: c.responsavel ?? '', valor: Number(c.valor) || 0 })
  })
  if (irmas.length === 0) return null
  const humana = irmas.find(c => ORIGENS_HUMANAS.has(c.categoria_origem ?? ''))
  const escolhida = humana ?? irmas[0]
  return {
    categoria: escolhida.categoria!,
    confianca: humana ? 0.97 : 0.85,
    motivo: humana ? 'mesma compra, categoria escolhida pelo casal' : 'mesma compra, outra parcela',
  }
}

const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function decidirCategorias(
  transacoes: TransacaoParaCategorizar[],
  ctx: ContextoPipeline
): Promise<ResultadoPipeline> {
  const { permitidas, memoria } = ctx
  const grupos = agrupar(transacoes)
  const decisoes: Decisao[] = []
  const semDecisao: string[] = []
  const erros: string[] = []
  let cotaDiariaEsgotada = false
  let chamadasIA = 0
  let feitas = 0

  const aplicar = (g: Grupo, d: Omit<Decisao, 'hash_linha'>) => {
    for (const m of g.membros) decisoes.push({ ...d, hash_linha: m.hash_linha })
    feitas += g.membros.length
    ctx.aoProgresso?.(feitas, transacoes.length)
  }

  const paraIA: Grupo[] = []
  for (const g of grupos) {
    const nome = g.representante.descricao_personalizada?.trim()

    const porParcela = decidirPorParcela(g, ctx.categorizadas, permitidas)
    if (porParcela) { aplicar(g, { ...porParcela, origem: 'PARCELA', status: 'automatico' }); continue }

    // Marketplace genérico com nome dado pelo casal: o nome decide, não a loja.
    const porMemoria = g.est.generico && nome ? null : memoria.consultar(g.representante.descricao)
    if (porMemoria) { aplicar(g, { ...porMemoria, origem: 'HISTORICO', status: 'automatico' }); continue }

    const porRegra =
      (nome ? aplicarRegras(normalizarEstabelecimento(nome).chave, g.valor, permitidas) : null) ??
      aplicarRegras(g.est.chave, g.valor, permitidas)
    if (porRegra) { aplicar(g, { ...porRegra, origem: 'REGRA', status: 'automatico' }); continue }

    paraIA.push(g)
  }

  if (paraIA.length > 0 && !ctx.ia) {
    for (const g of paraIA) semDecisao.push(...g.membros.map(m => m.hash_linha))
    return { decisoes, semDecisao, erros: ['IA indisponível (sem chave)'], cotaDiariaEsgotada, chamadasIA }
  }

  const tamanho = ctx.ia?.tamanhoLote ?? 25
  const exemplosGerais = memoria.exemplosGerais(40)
  for (let i = 0; i < paraIA.length; i += tamanho) {
    const lote = paraIA.slice(i, i + tamanho)
    if (cotaDiariaEsgotada || Date.now() >= ctx.ia!.deadlineMs - 5_000) {
      for (const g of lote) semDecisao.push(...g.membros.map(m => m.hash_linha))
      continue
    }

    const itens: ItemParaIA[] = lote.map((g, k) => ({
      id: String(k + 1),
      descricao: g.representante.descricao,
      nomePersonalizado: g.representante.descricao_personalizada,
      chave: g.est.chave,
      valor: g.valor,
      parcelas: g.total > 0 ? `${g.representante.parcela_atual ?? '?'}/${g.total}` : undefined,
      responsavel: g.resp || null,
      adquirente: g.est.adquirente,
      marketplace: g.est.marketplace,
      vendedor: g.est.vendedor,
      exemplos: memoria.exemplosParecidos(g.representante.descricao, 3),
    }))

    let respostas: Awaited<ReturnType<typeof classificarLoteIA>> | null = null
    for (let tentativa = 0; tentativa < 2 && !respostas; tentativa++) {
      try {
        chamadasIA++
        respostas = await classificarLoteIA(itens, permitidas, exemplosGerais, DESCRICAO_ADQUIRENTE, ctx.ia!)
      } catch (err) {
        if (err instanceof GeminiError && err.codigo === 'QUOTA') {
          if (err.detalhes?.diaria) { cotaDiariaEsgotada = true; break }
          const espera = ((err.detalhes?.segundos ?? 30) + 2) * 1000
          if (tentativa === 0 && Date.now() + espera < ctx.ia!.deadlineMs - 5_000) { await pausa(espera); continue }
        }
        erros.push(`Lote ${Math.floor(i / tamanho) + 1}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }

    lote.forEach((g, k) => {
      const r = respostas?.get(String(k + 1))
      if (!r) { semDecisao.push(...g.membros.map(m => m.hash_linha)); return }
      aplicar(g, {
        categoria: r.categoria,
        confianca: r.confianca,
        origem: 'IA',
        status: r.categoria === 'Outros' || r.confianca < CONFIANCA_MINIMA_IA ? 'revisao_pendente' : 'automatico',
        motivo: r.motivo,
      })
    })

    if (i + tamanho < paraIA.length && ctx.ia!.pausaEntreLotesMs) await pausa(ctx.ia!.pausaEntreLotesMs)
  }

  if (cotaDiariaEsgotada) erros.push('Cota diária do Gemini esgotada — o restante fica para amanhã.')
  return { decisoes, semDecisao, erros, cotaDiariaEsgotada, chamadasIA }
}
