/**
 * Parameterized, in-memory query tools for the AI chat — the safe
 * alternative to an open `run_sql`: never touch the database directly, only
 * filter the `EnrichedData` already fetched (and validated by
 * financialValidationEngine) for this turn. No new DB connection, role, or
 * credential is needed — see "Fase E" of the RAG restructuring plan.
 *
 * Every parameter is validated against a known enum/format and silently
 * ignored if invalid — never trust model-supplied arguments blindly.
 */

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CATEGORIAS_PADRAO } from '../categorias'
import { getMesEfetivo as mesEfetivo, isPlanejamentoDespesaReal } from './insightsEngine'
import type { EnrichedData } from './types'
import { formatBRLCompacto } from '@/lib/format'

const R = formatBRLCompacto

const fmtMes = (yyyyMM: string) => {
  try { return format(new Date(yyyyMM + '-02'), 'MMM/yy', { locale: ptBR }).toUpperCase() }
  catch { return yyyyMM }
}

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2']
const RESPONSAVEIS_VALIDOS = ['Matheus', 'Jeniffer']
const MES_REGEX = /^\d{4}-\d{2}$/
const RECEITA_PREFIXO = '[RECEITA] '

function normalizarCategoria(categoria?: string): string | undefined {
  if (!categoria) return undefined
  return CATEGORIAS_PADRAO.find(c => c.toLowerCase() === categoria.toLowerCase())
}

function normalizarEnum(valor: string | undefined, validos: string[]): string | undefined {
  if (!valor) return undefined
  return validos.find(v => v.toLowerCase() === valor.toLowerCase())
}

function normalizarMes(mes?: string): string | undefined {
  return mes && MES_REGEX.test(mes) ? mes : undefined
}

function formatarFiltros(partes: Array<string | false | undefined>): string {
  const aplicados = partes.filter(Boolean).join(' · ')
  return aplicados || 'nenhum (todos os meses disponíveis)'
}

// ─── Transações de cartão ─────────────────────────────────────────────────────

export interface ConsultaTransacoesParams {
  categoria?: string
  responsavel?: string
  cartao?: string
  mesInicio?: string
  mesFim?: string
}

export function consultarTransacoes(data: EnrichedData, params: ConsultaTransacoesParams): string {
  const categoria = normalizarCategoria(params.categoria)
  const responsavel = normalizarEnum(params.responsavel, RESPONSAVEIS_VALIDOS)
  const cartao = normalizarEnum(params.cartao, CARTOES_VALIDOS)
  const mesInicio = normalizarMes(params.mesInicio)
  const mesFim = normalizarMes(params.mesFim)

  const filtros = formatarFiltros([
    categoria && `categoria=${categoria}`,
    responsavel && `responsavel=${responsavel}`,
    cartao && `cartao=${cartao}`,
    mesInicio && `de=${mesInicio}`,
    mesFim && `até=${mesFim}`,
  ])

  const relevant = data.transacoes.filter(t => {
    const m = mesEfetivo(t)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    if (categoria && (t.categoria ?? '') !== categoria) return false
    if (responsavel && t.responsavel !== responsavel) return false
    if (cartao && (t.cartao ?? 'nubank') !== cartao) return false
    return true
  })

  if (relevant.length === 0) {
    return `CONSULTA TRANSAÇÕES (filtros: ${filtros}): nenhuma transação encontrada.`
  }

  const total = relevant.reduce((s, t) => s + t.valor, 0)

  const porMes: Record<string, number> = {}
  for (const t of relevant) {
    const m = mesEfetivo(t)
    porMes[m] = (porMes[m] ?? 0) + t.valor
  }
  // Capped regardless of how wide a date range was requested, so token cost
  // stays bounded even for "desde o início" style queries.
  const mensal = Object.entries(porMes)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([m, v]) => `${fmtMes(m)}: ${R(v)}`)
    .join(' · ')

  const maiores = [...relevant]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
    .map(t => `${t.descricao.slice(0, 30)} ${R(t.valor)} (${t.responsavel}, ${fmtMes(mesEfetivo(t))})`)
    .join(', ')

  return [
    `CONSULTA TRANSAÇÕES (filtros: ${filtros}):`,
    `Total: ${R(total)} em ${relevant.length} transação(ões)`,
    `Por mês: ${mensal}`,
    `Maiores: ${maiores}`,
  ].join('\n')
}

// ─── Planejamento / despesas fixas ────────────────────────────────────────────

export interface ConsultaPlanejamentoParams {
  categoria?: string
  responsavel?: string
  mesInicio?: string
  mesFim?: string
  pago?: boolean
}

export function consultarPlanejamento(data: EnrichedData, params: ConsultaPlanejamentoParams): string {
  const categoria = normalizarCategoria(params.categoria)
  const responsavel = normalizarEnum(params.responsavel, RESPONSAVEIS_VALIDOS)
  const mesInicio = normalizarMes(params.mesInicio)
  const mesFim = normalizarMes(params.mesFim)
  const pago = params.pago

  const filtros = formatarFiltros([
    categoria && `categoria=${categoria}`,
    responsavel && `responsavel=${responsavel}`,
    mesInicio && `de=${mesInicio}`,
    mesFim && `até=${mesFim}`,
    pago !== undefined && `pago=${pago}`,
  ])

  const relevant = data.planejamento.filter(p => {
    // Receitas ([RECEITA]*) e linhas internas de acerto de fatura
    // (NuBank/[CARTAO1]/[CARTAO2]) ficam fora — ver buildReceitasLayer para
    // receitas; essas não são despesas reais.
    if ((p.item ?? '').startsWith(RECEITA_PREFIXO)) return false
    if (!isPlanejamentoDespesaReal(p.item ?? '')) return false

    const m = (p.mes_referencia ?? '').substring(0, 7)
    if (mesInicio && m < mesInicio) return false
    if (mesFim && m > mesFim) return false
    if (categoria && (p.categoria ?? '') !== categoria) return false
    if (responsavel && p.responsavel !== responsavel) return false
    if (pago !== undefined && Boolean(p.data_pagamento) !== pago) return false
    return true
  })

  if (relevant.length === 0) {
    return `CONSULTA PLANEJAMENTO (filtros: ${filtros}): nenhuma despesa encontrada.`
  }

  const total = relevant.reduce((s, p) => s + p.valor_previsto, 0)

  const porMes: Record<string, number> = {}
  for (const p of relevant) {
    const m = (p.mes_referencia ?? '').substring(0, 7)
    porMes[m] = (porMes[m] ?? 0) + p.valor_previsto
  }
  const mensal = Object.entries(porMes)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([m, v]) => `${fmtMes(m)}: ${R(v)}`)
    .join(' · ')

  const itens = [...relevant]
    .sort((a, b) => b.valor_previsto - a.valor_previsto)
    .slice(0, 8)
    .map(p => `${p.item.slice(0, 30)} ${R(p.valor_previsto)} (${p.responsavel ?? 'compartilhado'}, ${p.data_pagamento ? 'pago' : 'em aberto'})`)
    .join(', ')

  return [
    `CONSULTA PLANEJAMENTO (filtros: ${filtros}):`,
    `Total: ${R(total)} em ${relevant.length} item(ns)`,
    `Por mês: ${mensal}`,
    `Itens: ${itens}`,
  ].join('\n')
}
