import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import {
  processarCSV,
  processarTransacoesJSON,
  TransacaoInputJSON,
  TransacaoNubank,
} from '@/lib/csvparser'
import { categorizarTransacoes, ResultadoCategorizar } from '@/lib/categorizarTransacoes'

export const maxDuration = 300

type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string }

function autenticar(req: NextRequest): AuthResult {
  const apiKey = process.env.NUBANK_IMPORT_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      status: 403,
      message: 'Endpoint desabilitado: NUBANK_IMPORT_API_KEY não configurada no servidor.',
    }
  }

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      message: 'Header Authorization ausente ou inválido. Use: Authorization: Bearer <api-key>',
    }
  }

  if (authHeader.slice(7) !== apiKey) {
    return { ok: false, status: 401, message: 'API key inválida.' }
  }

  return { ok: true }
}

async function salvarTransacoes(
  supabase: ReturnType<typeof criarSupabaseServer>,
  transacoes: TransacaoNubank[]
) {
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
  const hashesImportados: string[] = []

  if (novas.length > 0) {
    let insertResult = await supabase
      .from('transacoes_nubank')
      .upsert(novas, { onConflict: 'hash_linha' })

    // Compatibilidade com schema legado (coluna 'data' em vez de 'data_compra')
    if (insertResult.error && insertResult.error.message.includes('data_compra')) {
      const novasLegado = novas.map(t => {
        const { data_compra, ...resto } = t as any
        return { ...resto, data: data_compra }
      })
      insertResult = await supabase
        .from('transacoes_nubank')
        .upsert(novasLegado, { onConflict: 'hash_linha' })
    }

    if (insertResult.error) {
      throw new Error('Erro ao salvar transações: ' + insertResult.error.message)
    }

    for (const t of novas) {
      if (t.responsavel === 'Matheus') novosMatheus++
      else novosJeniffer++
      totalValor += t.valor
      hashesImportados.push(t.hash_linha)
    }
  }

  const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()

  return {
    totalLidas: transacoes.length,
    novas: novas.length,
    duplicatasNoArquivo,
    matheus: novosMatheus,
    jeniffer: novosJeniffer,
    total: totalValor.toFixed(2),
    mesesReprocessados: mesesNoArquivo,
    hashesImportados,
  }
}

export async function POST(req: NextRequest) {
  const auth = autenticar(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  try {
    const supabase = criarSupabaseServer(req)

    const { data: configs } = await supabase.from('configuracoes').select('chave, valor')
    const diaVencimento = parseInt(
      configs?.find((c: any) => c.chave === 'dia_vencimento')?.valor || '10'
    )
    const ajusteFechamento = parseInt(
      configs?.find((c: any) => c.chave === 'ajuste_fechamento')?.valor || '0'
    )

    const contentType = req.headers.get('content-type') ?? ''
    let transacoes: TransacaoNubank[]

    if (contentType.includes('multipart/form-data')) {
      // Formato 1: arquivo CSV via multipart/form-data (campo "file")
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json(
          { error: 'Campo "file" ausente no formulário.' },
          { status: 400 }
        )
      }
      const csvText = await file.text()
      transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento)
    } else {
      // Formato 2 e 3: corpo JSON
      let body: any
      try {
        body = await req.json()
      } catch {
        return NextResponse.json(
          { error: 'Body inválido: esperado JSON ou multipart/form-data com campo "file".' },
          { status: 400 }
        )
      }

      if (typeof body?.csv === 'string') {
        // Formato 2: CSV como texto no campo "csv"
        transacoes = processarCSV(body.csv, diaVencimento, ajusteFechamento)
      } else if (Array.isArray(body?.transacoes)) {
        // Formato 3: array de objetos de transação
        transacoes = processarTransacoesJSON(
          body.transacoes as TransacaoInputJSON[],
          diaVencimento,
          ajusteFechamento
        )
      } else {
        return NextResponse.json(
          {
            error:
              'Body deve conter "csv" (string com conteúdo CSV) ou "transacoes" (array de objetos).',
          },
          { status: 400 }
        )
      }
    }

    if (transacoes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Nenhuma transação válida encontrada. Verifique o formato e se os valores são positivos.',
        },
        { status: 422 }
      )
    }

    const resultadoImportacao = await salvarTransacoes(supabase, transacoes)

    // Categorização automática — pode ser desativada com ?categorizar=false
    const url = new URL(req.url)
    const deveCategorizar = url.searchParams.get('categorizar') !== 'false'

    let categorizacao: (ResultadoCategorizar & { ignorado?: string }) | null = null

    if (deveCategorizar) {
      const geminiKey = process.env.GEMINI_API_KEY
      if (!geminiKey) {
        categorizacao = {
          categorized: 0,
          total: 0,
          cotaDiariaEsgotada: false,
          ignorado: 'GEMINI_API_KEY não configurada no servidor.',
        }
      } else if (resultadoImportacao.hashesImportados.length > 0) {
        try {
          const resultado = await categorizarTransacoes(
            supabase,
            geminiKey,
            resultadoImportacao.hashesImportados,
            true // somenteSemCategoria: não reprocessa no Gemini o que já foi categorizado por IA
          )
          categorizacao = resultado
        } catch (err) {
          console.error('[nubank/importar] Erro na categorização:', err)
          categorizacao = {
            categorized: 0,
            total: resultadoImportacao.hashesImportados.length,
            cotaDiariaEsgotada: false,
            erros: [String(err)],
          }
        }
      } else {
        categorizacao = { categorized: 0, total: 0, cotaDiariaEsgotada: false }
      }
    }

    const { hashesImportados: _, ...importacaoPublica } = resultadoImportacao

    // Registra no log de atividades para exibição na tela
    const mesesStr = importacaoPublica.mesesReprocessados
      .map(m => m.substring(0, 7))
      .join(', ')
    await supabase.from('activity_logs').insert({
      acao: 'importar',
      tabela: 'transacoes_nubank',
      descricao: `${importacaoPublica.novas} novas via API (${importacaoPublica.matheus}M + ${importacaoPublica.jeniffer}J)${mesesStr ? ' · ' + mesesStr : ''}`,
      valor: parseFloat(importacaoPublica.total),
    })

    return NextResponse.json({
      success: true,
      importacao: importacaoPublica,
      categorizacao,
    })
  } catch (error) {
    console.error('[nubank/importar] Exceção:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
