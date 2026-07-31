import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { extrairParcela } from '@/lib/csvparser'
import type { SupabaseClient } from '@supabase/supabase-js'

type Transacao = {
  id: string
  descricao: string
  valor: number
  projeto_fatura: string
  responsavel: string | null
  parcela_atual: number | null
  total_parcelas: number | null
}

type Divergencia = {
  id: string
  descricao: string
  valor: number
  projeto_fatura: string
  responsavel: string | null
  parcela_atual_atual: number | null
  total_parcelas_atual: number | null
  parcela_atual_correta: number | null
  total_parcelas_correta: number | null
}

// Compara o que está salvo em cada linha com o que a extração validada de
// parcela (extrairParcela, a mesma usada na importação) encontraria a partir
// da descrição — sinaliza linhas importadas antes da correção da regex, que
// ficaram com total_parcelas indevido (ex.: casando uma data "12/2024").
function detectarDivergencias(transacoes: Transacao[]): Divergencia[] {
  const divergencias: Divergencia[] = []

  for (const t of transacoes) {
    const correta = extrairParcela(t.descricao)
    const atualParcela = t.parcela_atual
    const atualTotal = t.total_parcelas
    const corretaParcela = correta?.atual ?? null
    const corretaTotal = correta?.total ?? null

    if (atualParcela === corretaParcela && atualTotal === corretaTotal) continue

    divergencias.push({
      id: t.id,
      descricao: t.descricao,
      valor: t.valor,
      projeto_fatura: t.projeto_fatura,
      responsavel: t.responsavel,
      parcela_atual_atual: atualParcela,
      total_parcelas_atual: atualTotal,
      parcela_atual_correta: corretaParcela,
      total_parcelas_correta: corretaTotal,
    })
  }

  return divergencias
}

// O PostgREST limita cada select a no máximo 1000 linhas por padrão — sem
// paginar, tabelas maiores que isso ficam com o final silenciosamente de
// fora do diagnóstico (e da correção, que usa a mesma fonte).
const TAMANHO_PAGINA = 1000

async function buscarTodasTransacoes(supabase: SupabaseClient): Promise<Transacao[]> {
  const todas: Transacao[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, projeto_fatura, responsavel, parcela_atual, total_parcelas')
      .order('projeto_fatura', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + TAMANHO_PAGINA - 1)
    if (error) throw new Error(error.message)
    const pagina = data ?? []
    todas.push(...pagina)
    if (pagina.length < TAMANHO_PAGINA) break
    offset += TAMANHO_PAGINA
  }
  return todas
}

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const transacoes = await buscarTodasTransacoes(supabase)
    const divergencias = detectarDivergencias(transacoes)
    const viravamParcela = divergencias.filter(d => !d.total_parcelas_atual && d.total_parcelas_correta).length
    const deixavamDeSerParcela = divergencias.filter(d => d.total_parcelas_atual && !d.total_parcelas_correta).length
    const numerosDiferentes = divergencias.length - viravamParcela - deixavamDeSerParcela

    return NextResponse.json({
      total: divergencias.length,
      deixavamDeSerParcela, // hoje contam como parcelamento indevidamente (a causa provável do "comprometido" inflado)
      viravamParcela,
      numerosDiferentes,
      divergencias,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
