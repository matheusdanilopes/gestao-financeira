import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { processarCSV, TransacaoNubank } from '@/lib/csvparser'
import { notificarImportacao } from '@/lib/pushImportacao'

function adicionarDias(dataISO: string, dias: number): string {
  const d = new Date(dataISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}

async function contarNoBanco(
  supabase: ReturnType<typeof criarSupabaseServer>,
  item: TransacaoNubank,
  dataInicio: string,
  dataFim: string
): Promise<number> {
  const { count, error } = await supabase
    .from('transacoes_nubank')
    .select('*', { count: 'exact', head: true })
    .eq('descricao', item.descricao)
    .eq('valor', item.valor)
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)

  if (error?.message?.includes('data_compra')) {
    const { count: count2 } = await supabase
      .from('transacoes_nubank')
      .select('*', { count: 'exact', head: true })
      .eq('descricao', item.descricao)
      .eq('valor', item.valor)
      .gte('data', dataInicio)
      .lte('data', dataFim)
    return count2 ?? 0
  }

  return count ?? 0
}

async function inserirTransacao(
  supabase: ReturnType<typeof criarSupabaseServer>,
  item: TransacaoNubank
): Promise<boolean> {
  let result = await supabase.from('transacoes_nubank').insert(item)

  if (result.error?.message?.includes('data_compra')) {
    const { data_compra, ...resto } = item as any
    result = await supabase.from('transacoes_nubank').insert({ ...resto, data: data_compra })
  }

  if (!result.error) return true
  // 23505 = unique_violation: hash already exists, not a new row
  if (result.error.code === '23505' || result.error.message?.includes('duplicate')) return false
  throw new Error('Erro ao salvar: ' + result.error.message)
}

export async function POST(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 })

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

    const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()

    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0
    let verdadeiramenteNovas = 0
    let duplicatasIgnoradas = 0

    for (const item of transacoes) {
      const dataInicio = adicionarDias(item.data_compra, -3)
      const dataFim = adicionarDias(item.data_compra, 3)

      const qtdNoBanco = await contarNoBanco(supabase, item, dataInicio, dataFim)

      // Count how many times this exact (descricao, valor, date) appears in the CSV
      const qtdNoCsv = transacoes.filter(x =>
        x.descricao === item.descricao &&
        x.valor === item.valor &&
        x.data_compra === item.data_compra
      ).length

      if (qtdNoBanco < qtdNoCsv) {
        const inserido = await inserirTransacao(supabase, item)
        if (inserido) {
          verdadeiramenteNovas++
          if (item.responsavel === 'Matheus') novosMatheus++
          else novosJeniffer++
          totalValor += item.valor
        } else {
          duplicatasIgnoradas++
        }
      } else {
        duplicatasIgnoradas++
      }
    }

    await notificarImportacao(supabase, 'sucesso', verdadeiramenteNovas)

    return NextResponse.json({
      success: true,
      totalLidas: transacoes.length,
      novas: verdadeiramenteNovas,
      duplicatasNoArquivo: duplicatasIgnoradas,
      matheus: novosMatheus,
      jeniffer: novosJeniffer,
      total: totalValor.toFixed(2),
      mesesReprocessados: mesesNoArquivo,
    })
  } catch (error) {
    console.error('[import] Excecao:', error)
    const msg = error instanceof Error ? error.message : String(error)
    await notificarImportacao(supabase, 'erro')
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
