import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { processarCSV, TransacaoNubank } from '@/lib/csvparser'
import { notificarImportacao } from '@/lib/pushImportacao'

const CARTOES_VALIDOS = ['cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

function adicionarDias(dataISO: string, dias: number): string {
  const d = new Date(dataISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}

async function contarNoBanco(
  supabase: ReturnType<typeof criarSupabaseServer>,
  item: TransacaoNubank,
  dataInicio: string,
  dataFim: string,
  cartao: string
): Promise<number> {
  const { count, error } = await supabase
    .from('transacoes_nubank')
    .select('*', { count: 'exact', head: true })
    .eq('descricao', item.descricao)
    .eq('valor', item.valor)
    .eq('cartao', cartao)
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)

  if (error?.message?.includes('data_compra')) {
    const { count: count2 } = await supabase
      .from('transacoes_nubank')
      .select('*', { count: 'exact', head: true })
      .eq('descricao', item.descricao)
      .eq('valor', item.valor)
      .eq('cartao', cartao)
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
  if (result.error.code === '23505' || result.error.message?.includes('duplicate')) return false
  throw new Error('Erro ao salvar: ' + result.error.message)
}

export async function POST(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const cartao = formData.get('cartao') as string

    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 })
    if (!CARTOES_VALIDOS.includes(cartao as CartaoValido)) {
      return NextResponse.json(
        { error: 'Cartão inválido. Use "cartao1" ou "cartao2".' },
        { status: 400 }
      )
    }

    const { data: configs } = await supabase.from('configuracoes').select('chave, valor')
    const diaVencimento = parseInt(configs?.find((c: any) => c.chave === 'dia_vencimento')?.valor || '10')
    const ajusteFechamento = parseInt(configs?.find((c: any) => c.chave === 'ajuste_fechamento')?.valor || '0')

    const csvText = await file.text()
    const transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento, cartao)

    if (transacoes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Nenhuma transação válida. Verifique se o CSV está no formato correto (date, title, amount).',
      }, { status: 422 })
    }

    const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()

    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0
    let verdadeiramenteNovas = 0
    let duplicatasIgnoradas = 0

    type StatsFatura = { noCSV: number; inseridas: number; ignoradas: number; totalNoBanco: number }
    const faturaStats: Record<string, StatsFatura> = {}
    for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

    for (const item of transacoes) {
      const stats = faturaStats[item.projeto_fatura]
      stats.noCSV++

      const dataInicio = adicionarDias(item.data_compra, -3)
      const dataFim = adicionarDias(item.data_compra, 3)

      const qtdNoBanco = await contarNoBanco(supabase, item, dataInicio, dataFim, cartao)

      const qtdNoCsv = transacoes.filter(x =>
        x.descricao === item.descricao &&
        x.valor === item.valor &&
        x.data_compra === item.data_compra
      ).length

      if (qtdNoBanco < qtdNoCsv) {
        const inserido = await inserirTransacao(supabase, item)
        if (inserido) {
          verdadeiramenteNovas++
          stats.inseridas++
          if (item.responsavel === 'Matheus') novosMatheus++
          else novosJeniffer++
          totalValor += item.valor
        } else {
          duplicatasIgnoradas++
          stats.ignoradas++
        }
      } else {
        duplicatasIgnoradas++
        stats.ignoradas++
      }
    }

    for (const fatura of mesesNoArquivo) {
      const { count } = await supabase
        .from('transacoes_nubank')
        .select('*', { count: 'exact', head: true })
        .eq('projeto_fatura', fatura)
        .eq('cartao', cartao)
      faturaStats[fatura].totalNoBanco = count ?? 0
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
      resumoPorFatura: faturaStats,
    })
  } catch (error) {
    console.error('[import/cartao] Exceção:', error)
    const msg = error instanceof Error ? error.message : String(error)
    await notificarImportacao(supabase, 'erro')
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
