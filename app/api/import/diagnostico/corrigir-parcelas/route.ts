import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { extrairParcela } from '@/lib/csvparser'

type Transacao = {
  id: string
  descricao: string
  parcela_atual: number | null
  total_parcelas: number | null
}

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { data, error } = await supabase
      .from('transacoes_nubank')
      .select('id, descricao, parcela_atual, total_parcelas')

    if (error) throw new Error(error.message)

    const transacoes: Transacao[] = data ?? []
    const idsParaCorrigir: { id: string; parcela_atual: number | null; total_parcelas: number | null }[] = []

    for (const t of transacoes) {
      const correta = extrairParcela(t.descricao)
      const parcelaCorreta = correta?.atual ?? null
      const totalCorreto = correta?.total ?? null
      if (t.parcela_atual === parcelaCorreta && t.total_parcelas === totalCorreto) continue
      idsParaCorrigir.push({ id: t.id, parcela_atual: parcelaCorreta, total_parcelas: totalCorreto })
    }

    if (idsParaCorrigir.length === 0) {
      return NextResponse.json({ corrigidos: 0, mensagem: 'Nenhuma transação com parcelamento divergente encontrada.' })
    }

    // Agrupa por (parcela_atual, total_parcelas) para atualizar em lote com um único UPDATE por combinação
    const grupos = new Map<string, { parcela_atual: number | null; total_parcelas: number | null; ids: string[] }>()
    for (const item of idsParaCorrigir) {
      const chave = `${item.parcela_atual}|${item.total_parcelas}`
      const grupo = grupos.get(chave) ?? { parcela_atual: item.parcela_atual, total_parcelas: item.total_parcelas, ids: [] }
      grupo.ids.push(item.id)
      grupos.set(chave, grupo)
    }

    let totalCorrigidos = 0
    for (const grupo of grupos.values()) {
      for (let i = 0; i < grupo.ids.length; i += 100) {
        const lote = grupo.ids.slice(i, i + 100)
        const { error: updErr } = await supabase
          .from('transacoes_nubank')
          .update({ parcela_atual: grupo.parcela_atual, total_parcelas: grupo.total_parcelas })
          .in('id', lote)
        if (updErr) throw new Error('Erro ao corrigir: ' + updErr.message)
        totalCorrigidos += lote.length
      }
    }

    return NextResponse.json({
      corrigidos: totalCorrigidos,
      mensagem: `${totalCorrigidos} transação(ões) com parcelamento corrigido(s).`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
