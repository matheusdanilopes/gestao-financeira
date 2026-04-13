import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { processarCSV } from '@/lib/csvparser'

export async function POST(req: NextRequest) {
  try {
    const supabase = criarSupabaseServer(req)

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 })

    // Busca configurações de vencimento para calcular projeto_fatura corretamente
    const { data: configs } = await supabase.from('configuracoes').select('chave, valor')
    const diaVencimento = parseInt(configs?.find((c: any) => c.chave === 'dia_vencimento')?.valor || '10')
    const ajusteFechamento = parseInt(configs?.find((c: any) => c.chave === 'ajuste_fechamento')?.valor || '0')

    const csvText = await file.text()
    const transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento)

    if (transacoes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Nenhuma transacao valida. Verifique se e um CSV do Nubank.',
      }, { status: 422 })
    }

    // Busca hashes existentes em lotes de 200 (evita URLs muito longas)
    const LOTE = 200
    const hashesExistentes = new Set<string>()
    const todosHashes = transacoes.map(function(t) { return t.hash_linha })

    for (let i = 0; i < todosHashes.length; i += LOTE) {
      const lote = todosHashes.slice(i, i + LOTE)
      const resultado = await supabase
        .from('transacoes_nubank')
        .select('hash_linha')
        .in('hash_linha', lote)

      if (resultado.error) {
        console.error('[import] Erro consulta hashes:', JSON.stringify(resultado.error))
        return NextResponse.json(
          { error: 'Erro ao consultar banco: ' + resultado.error.message },
          { status: 500 }
        )
      }

      const rows = resultado.data ?? []
      for (let j = 0; j < rows.length; j++) {
        hashesExistentes.add(rows[j].hash_linha)
      }
    }

    const duplicatas = transacoes.filter(function(t) { return hashesExistentes.has(t.hash_linha) }).length
    const novas = transacoes.filter(function(t) { return !hashesExistentes.has(t.hash_linha) })

    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0

    if (novas.length > 0) {
      let insertResult = await supabase.from('transacoes_nubank').insert(novas)

      // Compatibilidade com bancos antigos: coluna pode ser 'data' em vez de 'data_compra'.
      if (insertResult.error && insertResult.error.message.includes("data_compra")) {
        const novasLegado = novas.map((t) => {
          const { data_compra, ...resto } = t as any
          return { ...resto, data: data_compra }
        })
        insertResult = await supabase.from('transacoes_nubank').insert(novasLegado)
      }

      if (insertResult.error) {
        console.error('[import] Erro insert:', JSON.stringify(insertResult.error))
        return NextResponse.json(
          { error: 'Erro ao salvar: ' + insertResult.error.message },
          { status: 500 }
        )
      }

      for (let k = 0; k < novas.length; k++) {
        const t = novas[k]
        if (t.responsavel === 'Matheus') novosMatheus++
        else novosJeniffer++
        totalValor += t.valor
      }
    }

    return NextResponse.json({
      success: true,
      totalLidas: transacoes.length,
      novas: novas.length,
      duplicatas,
      matheus: novosMatheus,
      jeniffer: novosJeniffer,
      total: totalValor.toFixed(2),
    })
  } catch (error) {
    console.error('[import] Excecao:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
