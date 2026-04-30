import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { gerarHashLinha } from '@/lib/csvparser'

type Transacao = {
  id: string
  descricao: string
  valor: number
  data_compra: string | null
  hash_linha: string | null
}

const BATCH_SIZE = 500

export async function POST(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
    // Fetch all transactions in batches
    const todas: Transacao[] = []
    let from = 0
    let usandoColunaLegada = false

    while (true) {
      const { data, error } = await supabase
        .from('transacoes_nubank')
        .select('id, descricao, valor, data_compra, hash_linha')
        .range(from, from + BATCH_SIZE - 1)

      if (error?.message?.includes('data_compra')) {
        usandoColunaLegada = true
        break
      }

      if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
      if (!data || data.length === 0) break

      todas.push(...(data as Transacao[]))
      if (data.length < BATCH_SIZE) break
      from += BATCH_SIZE
    }

    // Fallback para coluna legada 'data'
    if (usandoColunaLegada) {
      from = 0
      while (true) {
        const { data, error } = await supabase
          .from('transacoes_nubank')
          .select('id, descricao, valor, data, hash_linha')
          .range(from, from + BATCH_SIZE - 1)

        if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
        if (!data || data.length === 0) break

        todas.push(...(data as any[]).map((r) => ({ ...r, data_compra: r.data })))
        if (data.length < BATCH_SIZE) break
        from += BATCH_SIZE
      }
    }

    let atualizadas = 0
    let semAlteracao = 0
    let conflitos = 0
    const erros: string[] = []

    for (const row of todas) {
      const dataISO = (row.data_compra ?? '').substring(0, 10)

      if (!dataISO || !row.descricao || !row.valor) {
        erros.push(`id=${row.id}: dados incompletos (data=${dataISO}, desc=${!!row.descricao}, valor=${row.valor})`)
        continue
      }

      const novoHash = gerarHashLinha(dataISO, row.descricao, row.valor)

      if (novoHash === row.hash_linha) {
        semAlteracao++
        continue
      }

      const { error: updateError } = await supabase
        .from('transacoes_nubank')
        .update({ hash_linha: novoHash })
        .eq('id', row.id)

      if (!updateError) {
        atualizadas++
      } else if (
        updateError.code === '23505' ||
        updateError.message?.toLowerCase().includes('duplicate') ||
        updateError.message?.toLowerCase().includes('unique')
      ) {
        // Novo hash já existe → esta linha é duplicata de uma já normalizada → remover
        const { error: deleteError } = await supabase
          .from('transacoes_nubank')
          .delete()
          .eq('id', row.id)

        if (deleteError) {
          erros.push(`id=${row.id}: conflito de hash e falha ao remover: ${deleteError.message}`)
        } else {
          conflitos++
        }
      } else {
        erros.push(`id=${row.id}: ${updateError.message}`)
      }
    }

    return NextResponse.json({
      total: todas.length,
      atualizadas,
      semAlteracao,
      conflitosRemovidos: conflitos,
      erros,
    })
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ erro: mensagem }, { status: 500 })
  }
}
