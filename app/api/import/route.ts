import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import { gerarHashLinhaLegado, normalizarDescricaoParaHash, processarCSV } from '@/lib/csvparser'
import { notificarImportacao } from '@/lib/pushImportacao'

function chaveCanonica(t: { data_compra: string; descricao: string; valor: number }): string {
  return `${t.data_compra}|${normalizarDescricaoParaHash(t.descricao)}|${t.valor.toFixed(2)}`
}

export async function POST(req: NextRequest) {
  const supabase = criarSupabaseServer(req)

  try {
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
    let verdadeiramenteNovas = 0

    if (novas.length > 0) {
      const hashesAtuais = novas.map(t => t.hash_linha)
      const hashesLegado = novas.map(t => gerarHashLinhaLegado(t.data_compra, t.descricao, t.valor))
      const hashesParaConsulta = [...new Set([...hashesAtuais, ...hashesLegado])]
      const mesesParaConsulta = [...new Set(novas.map(t => t.projeto_fatura))]

      // Descobre quais hashes já existem no banco para calcular o delta real
      const { data: jaExistentes } = await supabase
        .from('transacoes_nubank')
        .select('hash_linha')
        .in('hash_linha', hashesParaConsulta)
      const hashesExistentes = new Set((jaExistentes ?? []).map(r => r.hash_linha))

      // Backstop adicional: dedupe por chave canônica (data + descrição + valor com 2 casas),
      // protegendo contra quaisquer variações históricas de hash_linha.
      // Fallback para schema legado: tenta 'data_compra', se a coluna não existir usa 'data'.
      const queryCanonica1 = await supabase
        .from('transacoes_nubank')
        .select('data_compra, descricao, valor')
        .in('projeto_fatura', mesesParaConsulta)
      const existentesCanonicos: any[] | null = queryCanonica1.error?.message.includes('data_compra')
        ? (await supabase
            .from('transacoes_nubank')
            .select('data, descricao, valor')
            .in('projeto_fatura', mesesParaConsulta)
          ).data
        : queryCanonica1.data
      const chavesCanonicasExistentes = new Set(
        (existentesCanonicos ?? []).map((r: any) =>
          chaveCanonica({
            data_compra: String(r.data_compra ?? r.data ?? ''),
            descricao: String(r.descricao ?? ''),
            valor: Number(r.valor ?? 0),
          })
        )
      )

      const novasParaInserir = novas.filter(t => {
        const hashLegado = gerarHashLinhaLegado(t.data_compra, t.descricao, t.valor)
        const canonica = chaveCanonica(t)
        return (
          !hashesExistentes.has(t.hash_linha) &&
          !hashesExistentes.has(hashLegado) &&
          !chavesCanonicasExistentes.has(canonica)
        )
      })

      const startTime = new Date()

      let insertResult = await supabase
        .from('transacoes_nubank')
        .upsert(novasParaInserir, { onConflict: 'hash_linha' })

      // Compatibilidade com bancos antigos: coluna pode ser 'data' em vez de 'data_compra'.
      if (insertResult.error && insertResult.error.message.includes('data_compra')) {
        const novasLegado = novasParaInserir.map((t) => {
          const { data_compra, ...resto } = t as any
          return { ...resto, data: data_compra }
        })
        insertResult = await supabase
          .from('transacoes_nubank')
          .upsert(novasLegado, { onConflict: 'hash_linha' })
      }

      if (insertResult.error) {
        console.error('[import] Erro insert:', JSON.stringify(insertResult.error))
        await notificarImportacao(supabase, 'erro')
        return NextResponse.json(
          { error: 'Erro ao salvar: ' + insertResult.error.message },
          { status: 500 }
        )
      }

      // Conta apenas registros efetivamente inseridos (created_at >= startTime),
      // descartando os que o upsert apenas atualizou.
      if (novasParaInserir.length > 0) {
        const { data: novosReais } = await supabase
          .from('transacoes_nubank')
          .select('hash_linha, responsavel, valor')
          .in('hash_linha', novasParaInserir.map(t => t.hash_linha))
          .gte('created_at', startTime.toISOString())

        verdadeiramenteNovas = novosReais?.length ?? 0
        for (const r of (novosReais ?? [])) {
          if (r.responsavel === 'Matheus') novosMatheus++
          else novosJeniffer++
          totalValor += Number(r.valor)
        }
      }
    }

    await notificarImportacao(supabase, 'sucesso', verdadeiramenteNovas)

    return NextResponse.json({
      success: true,
      totalLidas: transacoes.length,
      novas: verdadeiramenteNovas,
      duplicatasNoArquivo,
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
