import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import {
  processarCSV,
  processarTransacoesJSON,
  TransacaoInputJSON,
  TransacaoNubank,
} from '@/lib/csvparser'
import { categorizarTransacoes, ResultadoCategorizar } from '@/lib/categorizarTransacoes'
import { notificarImportacao } from '@/lib/pushImportacao'
import { conciliarTransacao } from '@/lib/conciliacao'

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

type StatsFatura = { noCSV: number; inseridas: number; ignoradas: number; totalNoBanco: number }

async function salvarTransacoes(
  supabase: ReturnType<typeof criarSupabaseServer>,
  transacoes: TransacaoNubank[]
) {
  let novosMatheus = 0
  let novosJeniffer = 0
  let totalValor = 0
  const hashesImportados: string[] = []
  let verdadeiramenteNovas = 0
  let duplicatasIgnoradas = 0
  let conciliados = 0
  let conflitos = 0

  const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()
  const faturaStats: Record<string, StatsFatura> = {}
  for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

  for (const item of transacoes) {
    const stats = faturaStats[item.projeto_fatura]
    stats.noCSV++

    const resultado = await conciliarTransacao(supabase, item, 'api')

    switch (resultado.acao) {
      case 'inserido':
        if (resultado.inseriu) {
          verdadeiramenteNovas++
          hashesImportados.push(item.hash_linha)
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
        // API não atualiza valor — este caso não deve ocorrer (conciliarTransacao retorna 'ignorado' para API)
        conciliados++
        break
      case 'conflito':
        // Conflito de valor: registrado com status CONFLITO_VALOR, notificação criada
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

  return {
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
    hashesImportados,
  }
}

export async function POST(req: NextRequest) {
  const auth = autenticar(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  const supabase = criarSupabaseServer(req)

  async function registrarLog(descricao: string, valor?: number) {
    try {
      await supabase.from('activity_logs').insert({
        acao: 'importar',
        tabela: 'transacoes_nubank',
        descricao,
        valor: valor ?? null,
      })
    } catch { /* falha no log nunca deve interromper a resposta */ }
  }

  try {
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
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        const msg = 'Campo "file" ausente no formulário.'
        await registrarLog(`ERRO: ${msg}`)
        await notificarImportacao(supabase, 'erro')
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      const csvText = await file.text()
      transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento)
    } else {
      let body: any
      try {
        body = await req.json()
      } catch {
        const msg = 'Body inválido: esperado JSON ou multipart/form-data com campo "file".'
        await registrarLog(`ERRO: ${msg}`)
        await notificarImportacao(supabase, 'erro')
        return NextResponse.json({ error: msg }, { status: 400 })
      }

      if (typeof body?.csv === 'string') {
        transacoes = processarCSV(body.csv, diaVencimento, ajusteFechamento)
      } else if (Array.isArray(body?.transacoes)) {
        transacoes = processarTransacoesJSON(
          body.transacoes as TransacaoInputJSON[],
          diaVencimento,
          ajusteFechamento
        )
      } else {
        const msg = 'Body deve conter "csv" (string com conteúdo CSV) ou "transacoes" (array de objetos).'
        await registrarLog(`ERRO: ${msg}`)
        await notificarImportacao(supabase, 'erro')
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    if (transacoes.length === 0) {
      const msg = 'Nenhuma transação válida encontrada. Verifique o formato e se os valores são positivos.'
      await registrarLog(`ERRO: ${msg}`)
      await notificarImportacao(supabase, 'erro')
      return NextResponse.json({ success: false, error: msg }, { status: 422 })
    }

    const resultadoImportacao = await salvarTransacoes(supabase, transacoes)

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
            true
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

    const mesesStr = importacaoPublica.mesesReprocessados.map(m => m.substring(0, 7)).join(', ')
    await registrarLog(
      `${importacaoPublica.novas} novas via API (${importacaoPublica.matheus}M + ${importacaoPublica.jeniffer}J)${mesesStr ? ' · ' + mesesStr : ''}`,
      parseFloat(importacaoPublica.total)
    )

    await notificarImportacao(supabase, 'sucesso', importacaoPublica.novas)

    return NextResponse.json({
      success: true,
      importacao: importacaoPublica,
      categorizacao,
    })
  } catch (error) {
    console.error('[nubank/importar] Exceção:', error)
    const msg = error instanceof Error ? error.message : String(error)
    await registrarLog(`ERRO: ${msg}`)
    await notificarImportacao(supabase, 'erro')
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
