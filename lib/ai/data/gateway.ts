/**
 * GatewayDados — a porta única por onde o assessor (app e Telegram) lê dados.
 *
 *   ┌──────────── turno do agente ────────────┐
 *   │ snapshot · auditoria · ferramentas       │
 *   └──────────────┬───────────────────────────┘
 *                  │ GatewayDados (um por turno)
 *        ┌─────────┼──────────────────────┐
 *        │ núcleo  │ histórico sob demanda │ fontes extras sob demanda
 *        │ (janela │ (meses antes da       │ (atividade, histórico de
 *        │ quente) │ janela quente)        │ assinaturas, importações…)
 *        └─────────┴───────── cache por instância, com invalidação ─┘
 *
 * Por que existe: o contextBuilder carregava tudo, de uma vez, com janelas e
 * tetos fixos (24 meses de compras, 3 meses/50 estornos, 300 desejos, só
 * listas ativas) e não enxergava várias tabelas. Com o Telegram o volume de
 * perguntas cresce e elas ficam mais variadas ("quando a Netflix aumentou?",
 * "quem lançou essa conta?", "essa compra foi importada?", "quanto gastei em
 * 2024?"). O gateway:
 *  - mantém o núcleo pequeno e em cache (uma leitura serve vários turnos, e
 *    turnos simultâneos na mesma instância compartilham a mesma leitura);
 *  - estende o histórico para trás só quando uma consulta pede um período
 *    anterior à janela — nenhum mês fica "fora do alcance";
 *  - lê as fontes extras só quando uma ferramenta precisa delas;
 *  - invalida o cache depois de uma gravação, para a próxima consulta do mesmo
 *    turno já ver o pagamento/lançamento que acabou de ser confirmado.
 */

import { format, startOfMonth, subMonths } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateFinancialData } from '../financialValidationEngine'
import type { EnrichedData, ValidationCertificate } from '../types'
import { agoraBrasil } from '../tempo'
import { carregarNucleo, carregarHistorico, primeiroMesComDados } from './nucleo'
import { lerTabela, type ConsultaTabela, type ResultadoLeitura } from './leitura'

/** Meses carregados de saída. O resto do histórico vem sob demanda. */
export const JANELA_QUENTE_MESES = 24

// Curto de propósito: a IA precisa refletir o que acabou de ser lançado em
// outra tela. A primeira mensagem de cada conversa força leitura fresca, e
// toda gravação feita pelo agente invalida o cache.
const TTL_MS = 60_000
const MAX_ENTRADAS_NUCLEO = 10
const MAX_ENTRADAS_FONTES = 40

interface EntradaNucleo {
  bruto: EnrichedData
  /** Início ('YYYY-MM-01') do trecho de compras/planejamento já carregado. */
  desde: string
  /** Mês mais antigo com registro no banco ('YYYY-MM-01'), ou null se vazio. */
  primeiroMes: string | null
  ts: number
  /** Serializa as extensões de histórico (dois turnos não carregam o mesmo trecho). */
  fila: Promise<void>
}

// Guardamos a PROMESSA: turnos simultâneos na mesma instância (duas mensagens
// seguidas no Telegram) esperam a mesma leitura em vez de fazer duas.
const cacheNucleo = new Map<string, { ts: number; promessa: Promise<EntradaNucleo> }>()
const cacheFontes = new Map<string, { ts: number; promessa: Promise<ResultadoLeitura<Record<string, unknown>>> }>()

function podar<V extends { ts: number }>(mapa: Map<string, V>, max: number) {
  if (mapa.size < max) return
  const maisAntiga = [...mapa.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
  if (maisAntiga) mapa.delete(maisAntiga[0])
}

/**
 * Esquece tudo que está em cache. Os dados são do casal: uma gravação feita
 * por uma pessoa muda o que a outra deve ver, então a limpeza é geral.
 */
export function invalidarCacheDados(): void {
  cacheNucleo.clear()
  cacheFontes.clear()
}

async function lerNucleo(supabase: SupabaseClient, hoje: Date): Promise<EntradaNucleo> {
  const desde = format(startOfMonth(subMonths(hoje, JANELA_QUENTE_MESES)), 'yyyy-MM-dd')
  const [bruto, primeiroMes] = await Promise.all([
    carregarNucleo(supabase, desde),
    primeiroMesComDados(supabase).catch(() => null),
  ])
  return { bruto, desde, primeiroMes, ts: Date.now(), fila: Promise.resolve() }
}

/**
 * Núcleo bruto (antes da auditoria), com cache por escopo. Resultado com
 * falha parcial não fica no cache: a próxima mensagem tenta de novo.
 */
export async function obterNucleo(
  supabase: SupabaseClient,
  escopo: string,
  forcar = false
): Promise<EntradaNucleo> {
  const agora = Date.now()
  const atual = cacheNucleo.get(escopo)
  if (!forcar && atual && agora - atual.ts < TTL_MS) {
    try { return await atual.promessa }
    catch { /* a leitura compartilhada falhou: tenta a própria abaixo */ }
  }

  podar(cacheNucleo, MAX_ENTRADAS_NUCLEO)
  const promessa = lerNucleo(supabase, agoraBrasil())
  cacheNucleo.set(escopo, { ts: agora, promessa })
  try {
    const entrada = await promessa
    if ((entrada.bruto.avisos ?? []).length > 0 && cacheNucleo.get(escopo)?.promessa === promessa) {
      cacheNucleo.delete(escopo)
    }
    return entrada
  } catch (err) {
    if (cacheNucleo.get(escopo)?.promessa === promessa) cacheNucleo.delete(escopo)
    throw err
  }
}

const mesParaData = (mes: string) => `${mes.substring(0, 7)}-01`

export interface Cobertura {
  /** Primeiro mês já carregado em memória ('YYYY-MM'). */
  carregadoDesde: string
  /** Mês mais antigo que existe no banco ('YYYY-MM'), ou null. */
  primeiroNoBanco: string | null
  /** true quando todo o histórico existente já está em memória. */
  completo: boolean
}

export class GatewayDados {
  private entrada?: EntradaNucleo
  /**
   * Visão auditada do núcleo. O OBJETO é o mesmo durante o turno inteiro: ao
   * estender o histórico ou recarregar depois de uma gravação, os campos são
   * substituídos nele, e quem guardou a referência já enxerga o dado novo.
   */
  private visao?: EnrichedData
  private certificado?: ValidationCertificate
  private sujo = false

  constructor(
    private readonly supabase: SupabaseClient,
    /** Chave do cache — o usuário da conversa. */
    private readonly escopo: string
  ) {}

  /** Carrega o núcleo e faz a auditoria. Chame uma vez no começo do turno. */
  async iniciar(forcar = false): Promise<{ dados: EnrichedData; certificado: ValidationCertificate }> {
    this.entrada = await obterNucleo(this.supabase, this.escopo, forcar)
    this.auditar()
    return { dados: this.visao!, certificado: this.certificado! }
  }

  /** Dados auditados, recarregados se uma gravação os deixou desatualizados. */
  async dados(): Promise<EnrichedData> {
    if (!this.entrada) await this.iniciar()
    else if (this.sujo) {
      this.sujo = false
      this.entrada = await obterNucleo(this.supabase, this.escopo, true)
      this.auditar()
    }
    return this.visao!
  }

  get cobertura(): Cobertura {
    const e = this.entrada
    const desde = e?.desde ?? ''
    const primeiro = e?.primeiroMes ?? null
    return {
      carregadoDesde: desde.substring(0, 7),
      primeiroNoBanco: primeiro ? primeiro.substring(0, 7) : null,
      completo: !primeiro || primeiro >= desde,
    }
  }

  /**
   * Garante em memória compras e planejamento a partir de `mes` ('YYYY-MM'),
   * no vocabulário do app (a fatura que fecha nesse mês está incluída).
   */
  async garantirDesde(mes: string): Promise<void> {
    await this.dados()
    const e = this.entrada!
    let alvo = mesParaData(mes)
    if (e.primeiroMes && alvo < e.primeiroMes) alvo = e.primeiroMes
    if (alvo >= e.desde) return

    e.fila = e.fila.then(async () => {
      if (alvo >= e.desde) return // outro turno já carregou este trecho
      const antigo = await carregarHistorico(this.supabase, { desde: alvo, ate: e.desde })
      e.bruto.transacoes.push(...antigo.transacoes)
      e.bruto.planejamento.push(...antigo.planejamento)
      e.bruto.estornos.push(...antigo.estornos)
      e.desde = alvo
    })
    await e.fila
    this.auditar()
  }

  /** Garante TODO o histórico em memória (consultas sem período: "a maior compra de todas"). */
  async garantirTudo(): Promise<void> {
    await this.dados()
    const primeiro = this.entrada!.primeiroMes
    if (primeiro) await this.garantirDesde(primeiro.substring(0, 7))
  }

  /** Lê uma fonte fora do núcleo (sob demanda), com cache. */
  async lerFonte(consulta: ConsultaTabela): Promise<ResultadoLeitura<Record<string, unknown>>> {
    const chave = `${this.escopo}|${JSON.stringify(consulta)}`
    const agora = Date.now()
    const atual = cacheFontes.get(chave)
    if (atual && agora - atual.ts < TTL_MS) {
      try { return await atual.promessa }
      catch { /* tenta de novo abaixo */ }
    }
    podar(cacheFontes, MAX_ENTRADAS_FONTES)
    const promessa = lerTabela<Record<string, unknown>>(this.supabase, consulta)
    cacheFontes.set(chave, { ts: agora, promessa })
    try {
      return await promessa
    } catch (err) {
      if (cacheFontes.get(chave)?.promessa === promessa) cacheFontes.delete(chave)
      throw err
    }
  }

  /** Depois de gravar algo: a próxima leitura (inclusive neste turno) vem do banco. */
  invalidar(): void {
    invalidarCacheDados()
    this.sujo = true
  }

  private auditar(): void {
    const { validatedData, certificate } = validateFinancialData(this.entrada!.bruto)
    // Cópias rasas das listas: o cache guarda as brutas, e cada turno pode
    // estender o histórico sem mexer no que outro turno está lendo.
    const novo: EnrichedData = {
      ...validatedData,
      planejamento: [...validatedData.planejamento],
      estornos: [...validatedData.estornos],
      avisos: [...(validatedData.avisos ?? [])],
    }
    if (this.visao) Object.assign(this.visao, novo)
    else this.visao = novo
    // A auditoria que vale para bloquear o turno é a do começo dele.
    this.certificado ??= certificate
  }
}
