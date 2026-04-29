import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { normalizarDescricaoParaHash } from '@/lib/csvparser'

type Transacao = {
  id: string
  descricao: string
  valor: number
  data_compra: string
  projeto_fatura: string
  categoria: string | null
  categoria_origem: string | null
}

// Returns the ID to delete from a pair.
// Priority: keep MANUAL > keep categorized > keep newer date (or smaller id for same-day).
// For same-day pairs (dias=0): sort is by id asc, so a.id < b.id → keep a, delete b.
// For date-shift pairs (dias>0): keep b (newer date = more accurate per Nubank), delete a.
function idParaExcluir(a: Transacao, b: Transacao, dias: number): string {
  if (a.categoria_origem === 'MANUAL' && b.categoria_origem !== 'MANUAL') return b.id
  if (b.categoria_origem === 'MANUAL' && a.categoria_origem !== 'MANUAL') return a.id
  if (a.categoria !== null && b.categoria === null) return b.id
  if (b.categoria !== null && a.categoria === null) return a.id
  if (dias === 0) return b.id // same day: keep a (smaller id in sorted order), delete b
  return a.id                 // date shift: keep newer date (b), delete older (a)
}

export async function POST(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
    const body = await req.json().catch(() => ({}))
    // "conservador" = same fatura only; "completo" = all pairs including cross-fatura
    const modo: 'conservador' | 'completo' = body?.modo === 'completo' ? 'completo' : 'conservador'

    let transacoes: Transacao[]
    const { data, error } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data_compra, projeto_fatura, categoria, categoria_origem')
      .order('descricao')
      .order('valor')
      .order('data_compra')

    if (error?.message?.includes('data_compra')) {
      const { data: legado, error: err2 } = await supabase
        .from('transacoes_nubank')
        .select('id, descricao, valor, data, projeto_fatura, categoria, categoria_origem')
        .order('descricao')
        .order('valor')
        .order('data')
      if (err2) throw new Error(err2.message)
      transacoes = (legado ?? []).map((r: any) => ({ ...r, data_compra: r.data }))
    } else {
      if (error) throw new Error(error.message)
      transacoes = data ?? []
    }

    // Secondary sort by id ensures deterministic ordering for same-date pairs
    const sorted = [...transacoes].sort((a, b) => {
      const da = normalizarDescricaoParaHash(a.descricao)
      const db = normalizarDescricaoParaHash(b.descricao)
      if (da !== db) return da.localeCompare(db)
      if (a.valor !== b.valor) return a.valor - b.valor
      if (a.data_compra !== b.data_compra) return a.data_compra.localeCompare(b.data_compra)
      return a.id.localeCompare(b.id)
    })

    const idsParaExcluir = new Set<string>()
    const idsParaManter = new Set<string>()

    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]
      const normA = normalizarDescricaoParaHash(a.descricao)

      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]
        if (normalizarDescricaoParaHash(b.descricao) !== normA || b.valor !== a.valor) break

        const dias = Math.round(
          Math.abs(
            new Date(b.data_compra + 'T12:00:00').getTime() -
            new Date(a.data_compra + 'T12:00:00').getTime()
          ) / 86_400_000
        )
        if (dias > 3) break

        if (modo === 'conservador' && a.projeto_fatura !== b.projeto_fatura) continue

        const excluir = idParaExcluir(a, b, dias)
        const manter = excluir === a.id ? b.id : a.id
        idsParaExcluir.add(excluir)
        idsParaManter.add(manter)
      }
    }

    // Safety: never delete an ID that is the "keep" choice in another pair
    const idsFinais = [...idsParaExcluir].filter(id => !idsParaManter.has(id))

    if (idsFinais.length === 0) {
      return NextResponse.json({ removidos: 0, mensagem: 'Nenhuma duplicata para remover.' })
    }

    // Delete in batches of 100 to stay within PostgREST limits
    let totalRemovidos = 0
    for (let i = 0; i < idsFinais.length; i += 100) {
      const lote = idsFinais.slice(i, i + 100)
      const { error: delErr } = await supabase
        .from('transacoes_nubank')
        .delete()
        .in('id', lote)
      if (delErr) throw new Error('Erro ao deletar: ' + delErr.message)
      totalRemovidos += lote.length
    }

    return NextResponse.json({
      removidos: totalRemovidos,
      mensagem: `${totalRemovidos} registro(s) duplicado(s) removido(s).`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
