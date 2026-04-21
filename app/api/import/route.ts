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

    // Detecta todos os meses (projeto_fatura) presentes no arquivo
    const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()

    // Deduplica por hash dentro do arquivo (mesmo CSV pode ter linhas iguais)
    const vistosNoArquivo = new Set<string>()
    const novas = transacoes.filter(t => {
      if (vistosNoArquivo.has(t.hash_linha)) return false
      vistosNoArquivo.add(t.hash_linha)
      return true
    })
    const duplicatasNoArquivo = transacoes.length - novas.length

    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0

    if (novas.length > 0) {
      let insertResult = await supabase
        .from('transacoes_nubank')
        .upsert(novas, { onConflict: 'hash_linha' })

      // Compatibilidade com bancos antigos: coluna pode ser 'data' em vez de 'data_compra'.
      if (insertResult.error && insertResult.error.message.includes('data_compra')) {
        const novasLegado = novas.map((t) => {
          const { data_compra, ...resto } = t as any
          return { ...resto, data: data_compra }
        })
        insertResult = await supabase
          .from('transacoes_nubank')
          .upsert(novasLegado, { onConflict: 'hash_linha' })
      }

      if (insertResult.error) {
        console.error('[import] Erro insert:', JSON.stringify(insertResult.error))
        return NextResponse.json(
          { error: 'Erro ao salvar: ' + insertResult.error.message },
          { status: 500 }
        )
      }

      for (const t of novas) {
        if (t.responsavel === 'Matheus') novosMatheus++
        else novosJeniffer++
        totalValor += t.valor
      }
    }

    return NextResponse.json({
      success: true,
      totalLidas: transacoes.length,
      novas: novas.length,
      duplicatasNoArquivo,
      matheus: novosMatheus,
      jeniffer: novosJeniffer,
      total: totalValor.toFixed(2),
      mesesReprocessados: mesesNoArquivo,
    })
  } catch (error) {
    console.error('[import] Excecao:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
