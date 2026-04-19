import { NextRequest, NextResponse } from 'next/server'
import { format, startOfMonth } from 'date-fns'
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

    // Meses futuros (projeto_fatura > mês atual) não são apagados — só mesclados
    const mesAtualStr = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const mesesFuturos  = mesesNoArquivo.filter(m => m >  mesAtualStr)
    const mesesPassados = mesesNoArquivo.filter(m => m <= mesAtualStr)

    // Apaga TODOS os registros dos meses passados/atuais antes de reinserir (overwrite completo)
    const mesesApagados: string[] = []
    for (const mes of mesesPassados) {
      const { error: deleteError, count } = await supabase
        .from('transacoes_nubank')
        .delete()
        .eq('projeto_fatura', mes)

      if (deleteError) {
        console.error('[import] Erro ao apagar mês:', mes, deleteError)
        return NextResponse.json(
          { error: 'Erro ao limpar mês ' + mes + ': ' + deleteError.message },
          { status: 500 }
        )
      }
      mesesApagados.push(mes)
    }

    // Deduplica por hash dentro do arquivo (mesmo CSV pode ter linhas iguais)
    const vistosNoArquivo = new Set<string>()
    const novas = transacoes.filter(t => {
      if (vistosNoArquivo.has(t.hash_linha)) return false
      vistosNoArquivo.add(t.hash_linha)
      return true
    })
    const duplicatasNoArquivo = transacoes.length - novas.length

    // Para meses futuros: filtra transações que já existem no banco (evita duplicar sem apagar)
    let novasParaInserir = novas
    if (mesesFuturos.length > 0) {
      const { data: existentes } = await supabase
        .from('transacoes_nubank')
        .select('hash_linha')
        .in('projeto_fatura', mesesFuturos)

      const hashesExistentes = new Set((existentes ?? []).map((e: any) => e.hash_linha))
      novasParaInserir = novas.filter(t =>
        !mesesFuturos.includes(t.projeto_fatura) || !hashesExistentes.has(t.hash_linha)
      )
    }

    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0

    if (novasParaInserir.length > 0) {
      let insertResult = await supabase
        .from('transacoes_nubank')
        .insert(novasParaInserir)

      // Compatibilidade com bancos antigos: coluna pode ser 'data' em vez de 'data_compra'.
      if (insertResult.error && insertResult.error.message.includes('data_compra')) {
        const novasLegado = novasParaInserir.map((t) => {
          const { data_compra, ...resto } = t as any
          return { ...resto, data: data_compra }
        })
        insertResult = await supabase
          .from('transacoes_nubank')
          .insert(novasLegado)
      }

      if (insertResult.error) {
        console.error('[import] Erro insert:', JSON.stringify(insertResult.error))
        return NextResponse.json(
          { error: 'Erro ao salvar: ' + insertResult.error.message },
          { status: 500 }
        )
      }

      for (const t of novasParaInserir) {
        if (t.responsavel === 'Matheus') novosMatheus++
        else novosJeniffer++
        totalValor += t.valor
      }
    }

    return NextResponse.json({
      success: true,
      totalLidas: transacoes.length,
      novas: novasParaInserir.length,
      duplicatasNoArquivo,
      matheus: novosMatheus,
      jeniffer: novosJeniffer,
      total: totalValor.toFixed(2),
      mesesSobrescritos: mesesApagados,
      mesesFuturos,
    })
  } catch (error) {
    console.error('[import] Excecao:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
