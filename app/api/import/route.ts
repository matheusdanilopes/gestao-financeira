import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { processarCSV } from '@/lib/csvparser'
import { notificarImportacao } from '@/lib/pushImportacao'
import { conciliarTransacao, conciliarEstorno } from '@/lib/conciliacao'
import { validarDivergenciaFatura } from '@/lib/validacaoFatura'
import { sincronizarAssinaturasMoedaEstrangeira } from '@/lib/assinaturasSync'

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 })

    // Validate file size (max 5 MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande (máximo 5 MB)' }, { status: 413 })
    }

    const { data: configs } = await supabase.from('configuracoes').select('chave, valor')
    const diaVencimento = parseInt(configs?.find((c: { chave: string; valor: string }) => c.chave === 'dia_vencimento')?.valor || '10')
    const ajusteFechamento = parseInt(configs?.find((c: { chave: string; valor: string }) => c.chave === 'ajuste_fechamento')?.valor || '0')

    const csvText = await file.text()
    const transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento)

    const transacoesNormais = transacoes.filter(t => !t.is_estorno)
    const estornos = transacoes.filter(t => t.is_estorno)

    if (transacoesNormais.length === 0 && estornos.length === 0) {
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
    let estornosAplicados = 0
    let estornosRegistrados = 0
    const importTs = Date.now()
    const purchaseDates: string[] = []

    type StatsFatura = { noCSV: number; inseridas: number; ignoradas: number; totalNoBanco: number }
    const faturaStats: Record<string, StatsFatura> = {}
    for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

    for (const item of transacoesNormais) {
      const stats = faturaStats[item.projeto_fatura]
      stats.noCSV++

      const resultado = await conciliarTransacao(supabase, item, 'csv')

      switch (resultado.acao) {
        case 'inserido':
          if (resultado.inseriu) {
            verdadeiramenteNovas++
            purchaseDates.push(item.data_compra)
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
          purchaseDates.push(item.data_compra)
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

    for (const estorno of estornos) {
      const resultado = await conciliarEstorno(supabase, estorno)
      if (resultado.acao === 'aplicado')   estornosAplicados++
      if (resultado.acao === 'registrado') estornosRegistrados++
    }

    for (const fatura of mesesNoArquivo) {
      const { count } = await supabase
        .from('transacoes_nubank')
        .select('*', { count: 'exact', head: true })
        .eq('projeto_fatura', fatura)
        .eq('cartao', 'nubank')
        .eq('is_estorno', false)
      faturaStats[fatura].totalNoBanco = count ?? 0
    }

    await validarDivergenciaFatura(supabase, faturaStats, transacoesNormais, 'nubank')

    const assinaturasAtualizadas = await sincronizarAssinaturasMoedaEstrangeira(supabase, 'nubank', mesesNoArquivo)

    await notificarImportacao(supabase, 'sucesso', verdadeiramenteNovas, conflitos, 'nubank', undefined, {
      purchaseDates,
      projetoFaturas: mesesNoArquivo,
      importTs,
      estornosAplicados,
      estornosRegistrados,
    })

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
      estornos: estornos.length,
      estornosAplicados,
      estornosRegistrados,
      assinaturasAtualizadas,
    })
  } catch (error) {
    console.error('[import] Excecao:', error instanceof Error ? error.message : 'unknown')
    await notificarImportacao(supabase, 'erro', undefined, undefined, 'nubank', undefined, { importTs: Date.now() })
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
  }
}
