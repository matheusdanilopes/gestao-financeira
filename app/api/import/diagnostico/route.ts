import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { normalizarDescricaoParaHash } from '@/lib/csvparser'

export async function GET(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
    // Fetch all transactions with just the fields needed for duplicate detection
    const { data, error } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, valor, data_compra, projeto_fatura, categoria, categoria_origem')
      .order('descricao')
      .order('valor')
      .order('data_compra')

    if (error) {
      // Schema legado: tenta coluna 'data'
      if (error.message?.includes('data_compra')) {
        const { data: dataLegado, error: errLegado } = await supabase
          .from('transacoes_nubank')
          .select('id, descricao, valor, data, projeto_fatura, categoria, categoria_origem')
          .order('descricao')
          .order('valor')
          .order('data')
        if (errLegado) throw new Error(errLegado.message)
        // Normaliza para o formato atual
        const normalizado = (dataLegado ?? []).map((r: any) => ({ ...r, data_compra: r.data }))
        return NextResponse.json(detectarDuplicatas(normalizado))
      }
      throw new Error(error.message)
    }

    return NextResponse.json(detectarDuplicatas(data ?? []))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}

type Transacao = {
  id: string
  descricao: string
  valor: number
  data_compra: string
  projeto_fatura: string
  categoria: string | null
  categoria_origem: string | null
}

type ParDuplicata = {
  descricao: string
  valor: number
  data_a: string
  data_b: string
  dias: number
  fatura_a: string
  fatura_b: string
  mesmaFatura: boolean
  id_a: string
  id_b: string
}

type Resultado = {
  totalPares: number
  mesmaFatura: number
  faturasDiferentes: number
  porFatura: Record<string, number>
  pares: ParDuplicata[]
}

function detectarDuplicatas(transacoes: Transacao[]): Resultado {
  // Sort by normalized descricao → valor → data_compra for efficient pairwise scan
  const sorted = [...transacoes].sort((a, b) => {
    const da = normalizarDescricaoParaHash(a.descricao)
    const db = normalizarDescricaoParaHash(b.descricao)
    if (da !== db) return da.localeCompare(db)
    if (a.valor !== b.valor) return a.valor - b.valor
    return a.data_compra.localeCompare(b.data_compra)
  })

  const pares: ParDuplicata[] = []

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    const normA = normalizarDescricaoParaHash(a.descricao)

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]
      const normB = normalizarDescricaoParaHash(b.descricao)

      // Sorted: once descricao or valor diverges, no more matches for a
      if (normB !== normA || b.valor !== a.valor) break

      const msA = new Date(a.data_compra + 'T12:00:00').getTime()
      const msB = new Date(b.data_compra + 'T12:00:00').getTime()
      const dias = Math.round(Math.abs(msB - msA) / 86_400_000)

      // Only flag 1–3 day differences (exact same date handled by existing scripts)
      if (dias === 0) continue
      if (dias > 3) break  // sorted by date → no more within range

      pares.push({
        descricao: a.descricao,
        valor: a.valor,
        data_a: a.data_compra,
        data_b: b.data_compra,
        dias,
        fatura_a: a.projeto_fatura,
        fatura_b: b.projeto_fatura,
        mesmaFatura: a.projeto_fatura === b.projeto_fatura,
        id_a: a.id,
        id_b: b.id,
      })
    }
  }

  const porFatura: Record<string, number> = {}
  let mesmaFatura = 0
  let faturasDiferentes = 0

  for (const p of pares) {
    if (p.mesmaFatura) {
      mesmaFatura++
      porFatura[p.fatura_a] = (porFatura[p.fatura_a] ?? 0) + 1
    } else {
      faturasDiferentes++
      porFatura[p.fatura_a] = (porFatura[p.fatura_a] ?? 0) + 1
      porFatura[p.fatura_b] = (porFatura[p.fatura_b] ?? 0) + 1
    }
  }

  return {
    totalPares: pares.length,
    mesmaFatura,
    faturasDiferentes,
    porFatura,
    pares,
  }
}
