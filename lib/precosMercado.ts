'use client'

// Preços pagos anteriormente (histórico de compras da Lista de Mercado) e
// detecção de preço provavelmente digitado errado — ex.: "4990" virando
// R$ 49,90 em vez de R$ 4,99 ao digitar com uma mão dentro do mercado.

import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { normalizarNomeItem } from './listaMercadoDuplicados'
import { formatBRL } from './format'

export type PrecoAnterior = { preco: number; data: string }
export type MapaPrecos = Record<string, PrecoAnterior>

const CACHE_KEY = 'lista-mercado-precos-anteriores'
const LIMITE_REGISTROS = 30

/** Acima disso um preço unitário de mercado é tratado como suspeito. */
export const PRECO_UNIT_ALTO = 500
/** Diferença (em vezes) em relação ao último preço que dispara o alerta. */
export const FATOR_DIVERGENCIA = 5

type RegistroHistorico = {
  data_hora: string
  itens: { nome: string; preco_unit: number | null }[] | null
}

/** Monta o mapa nome normalizado → último preço pago (registros do mais novo ao mais antigo). */
export function montarMapaPrecos(registros: readonly RegistroHistorico[]): MapaPrecos {
  const mapa: MapaPrecos = {}
  for (const r of registros) {
    for (const item of r.itens ?? []) {
      const preco = Number(item.preco_unit)
      if (!item.nome || !Number.isFinite(preco) || preco <= 0) continue
      const chave = normalizarNomeItem(item.nome)
      if (!mapa[chave]) mapa[chave] = { preco, data: r.data_hora }
    }
  }
  return mapa
}

export function precoAnteriorDe(mapa: MapaPrecos, nome: string): PrecoAnterior | null {
  return mapa[normalizarNomeItem(nome)] ?? null
}

/**
 * Retorna uma mensagem de alerta quando o preço digitado parece erro de
 * digitação, ou null quando está dentro do esperado.
 */
export function alertaPreco(preco: number | null, anterior: PrecoAnterior | null): string | null {
  if (preco == null || !Number.isFinite(preco) || preco <= 0) return null
  if (anterior && anterior.preco > 0) {
    const fator = preco / anterior.preco
    if (fator >= FATOR_DIVERGENCIA) {
      return `${formatBRL(preco)} é ${Math.round(fator)}× o último preço pago (${formatBRL(anterior.preco)}). Confira a vírgula.`
    }
    if (fator <= 1 / FATOR_DIVERGENCIA) {
      return `${formatBRL(preco)} é bem menor que o último preço pago (${formatBRL(anterior.preco)}). Confira a vírgula.`
    }
  }
  if (preco > PRECO_UNIT_ALTO) {
    return `${formatBRL(preco)} por unidade parece alto. Confira a vírgula.`
  }
  return null
}

/**
 * Alerta para o valor total pago ao finalizar. Só compara quando todos os
 * itens comprados têm preço (senão a estimativa é naturalmente menor).
 */
export function alertaTotal(valor: number, estimado: number, todosComPreco: boolean): string | null {
  if (!todosComPreco || !Number.isFinite(valor) || valor <= 0 || estimado <= 0) return null
  const fator = valor / estimado
  if (fator >= 3 || fator <= 1 / 3) {
    return `${formatBRL(valor)} está muito diferente do estimado pela lista (${formatBRL(estimado)}). Confira o valor.`
  }
  return null
}

function lerCache(): MapaPrecos {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

/** Últimos preços pagos por item. Usa cache local para funcionar offline. */
export function usePrecosAnteriores(): MapaPrecos {
  // Lido na montagem (o mapa só é usado nos sheets, abertos após a hidratação)
  const [mapa, setMapa] = useState<MapaPrecos>(lerCache)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('historico_compras')
          .select('data_hora, itens')
          .order('data_hora', { ascending: false })
          .limit(LIMITE_REGISTROS)
        if (error || !data || !ativo) return
        const novo = montarMapaPrecos(data as RegistroHistorico[])
        setMapa(novo)
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(novo)) } catch { /* ignore */ }
      } catch { /* offline: fica com o cache */ }
    })()
    return () => { ativo = false }
  }, [])

  return mapa
}
