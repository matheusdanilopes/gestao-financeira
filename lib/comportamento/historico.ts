'use client'

/**
 * Última análise de comportamento, guardada no aparelho.
 *
 * A análise só é gerada quando o usuário pede — então reabrir a tela precisa
 * mostrar a última leitura em vez de uma página vazia. Guarda também um
 * histórico curto das notas, para a tela mostrar a evolução entre análises.
 */

import { useSyncExternalStore } from 'react'
import type { EscopoAnalise, JanelaAnalise, ResultadoAnalise } from './tipos'

const CHAVE = 'analise_comportamento_v1'
const MAX_HISTORICO = 12

export interface RegistroHistorico {
  geradaEm: string
  nota: number
  janela: JanelaAnalise
  escopo: EscopoAnalise
}

export interface EstadoAnalises {
  ultima: ResultadoAnalise | null
  historico: RegistroHistorico[]
}

const VAZIO: EstadoAnalises = { ultima: null, historico: [] }
let estado: EstadoAnalises = VAZIO
let carregado = false
const ouvintes = new Set<() => void>()

function carregar(): void {
  if (carregado) return
  carregado = true
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return
    const lido = JSON.parse(bruto) as Partial<EstadoAnalises>
    // Uma versão com outro formato não pode quebrar a tela: descarta.
    if (lido.ultima && !lido.ultima.analise?.manchete) return
    estado = { ultima: lido.ultima ?? null, historico: Array.isArray(lido.historico) ? lido.historico : [] }
  } catch { /* storage indisponível ou corrompido */ }
}

function lerEstado(): EstadoAnalises {
  carregar()
  return estado
}

function snapshotServidor(): EstadoAnalises {
  return VAZIO
}

function aoMudar(fn: () => void): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}

export function salvarAnalise(resultado: ResultadoAnalise): void {
  carregar()
  const registro: RegistroHistorico = {
    geradaEm: resultado.geradaEm,
    nota: resultado.metricas.saude.nota,
    janela: resultado.parametros.janela,
    escopo: resultado.parametros.escopo,
  }
  estado = { ultima: resultado, historico: [...estado.historico, registro].slice(-MAX_HISTORICO) }
  try { localStorage.setItem(CHAVE, JSON.stringify(estado)) } catch { /* sem espaço: fica só na memória */ }
  ouvintes.forEach(fn => fn())
}

export function useAnalisesSalvas(): EstadoAnalises {
  return useSyncExternalStore(aoMudar, lerEstado, snapshotServidor)
}
