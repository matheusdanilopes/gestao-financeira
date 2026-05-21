import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { processarCSV } from '@/lib/csvparser'
import { notificarImportacao } from '@/lib/pushImportacao'
import { conciliarTransacao } from '@/lib/conciliacao'

export async function POST(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 })

    const { data: configs } = await supabase.from('configuracoes').select('chave, valor')
    const diaVencimento = parseInt(configs?.find((c: { chave: string; valor: string }) => c.chave === 'dia_vencimento')?.valor || '10')
    const ajusteFechamento = parseInt(configs?.find((c: { chave: string; valor: string }) => c.chave === 'ajuste_fechamento')?.valor || '0')

    const csvText = await file.text()
    const transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento)

    if (transacoes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Nenhuma transacao valida. Verifique se e um CSV do Nubank.',
      }, { status: 422 })
    }

    const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()

    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0
    let verdadeiramenteNovas = 0
    let duplicatasIgnoradas = 0
    let conciliados = 0
    let conflitos = 0

    type StatsFatura = { noCSV: number; inseridas: number; ignoradas: number; totalNoBanco: number }
    const faturaStats: Record<string, StatsFatura> = {}
    for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

    for (const item of transacoes) {
      const stats = faturaStats[item.projeto_fatura]
      stats.noCSV++

      const resultado = await conciliarTransacao(supabase, item, 'csv')

      switch (resultado.acao) {
        case 'inserido':
          if (resultado.inseriu) {
            verdadeiramenteNovas++
            stats.inseridas++
            if (item.responsavel === 'Matheus') novosMatheus++
            else novosJeniffer++
            totalValor += item.valor
          } else {
            duplicatasIgnoradas++
            stats.ignoradas++
          }
          break
        case 'conciliado':
          conciliados++
          stats.inseridas++
          break
        case 'conflito':
          conflitos++
          stats.inseridas++
          if (item.responsavel === 'Matheus') novosMatheus++
          else novosJeniffer++
          totalValor += item.valor
          break
        case 'ignorado':
          duplicatasIgnoradas++
          stats.ignoradas++
          break
      }
    }

    for (const fatura of mesesNoArquivo) {
      const { count } = await supabase
        .from('transacoes_nubank')
        .select('*', { count: 'exact', head: true })
        .eq('projeto_fatura', fatura)
      faturaStats[fatura].totalNoBanco = count ?? 0
    }

    await notificarImportacao(supabase, 'sucesso', verdadeiramenteNovas, conflitos, 'nubank')

    return NextResponse.json({
      success: true,
      totalLidas: transacoes.length,
      novas: verdadeiramenteNovas,
      conciliados,
      conflitos,
      duplicatasNoArquivo: duplicatasIgnoradas,
      matheus: novosMatheus,
      jeniffer: novosJeniffer,
      total: totalValor.toFixed(2),
      mesesReprocessados: mesesNoArquivo,
      resumoPorFatura: faturaStats,
    })
  } catch (error) {
    console.error('[import] Excecao:', error)
    const msg = error instanceof Error ? error.message : String(error)
    await notificarImportacao(supabase, 'erro', undefined, undefined, 'nubank')
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
