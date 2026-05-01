import { NextRequest, NextResponse } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import {
  processarCSV,
  processarTransacoesJSON,
  TransacaoInputJSON,
  TransacaoNubank,
  normalizarDescricaoParaHash,
} from '@/lib/csvparser'
import { categorizarTransacoes, ResultadoCategorizar } from '@/lib/categorizarTransacoes'
import { notificarImportacao } from '@/lib/pushImportacao'

export const maxDuration = 300

function adicionarDias(dataISO: string, dias: number): string {
  const d = new Date(dataISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}

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

async function contarNoBanco(
  supabase: ReturnType<typeof criarSupabaseServer>,
  item: TransacaoNubank,
  dataInicio: string,
  dataFim: string
): Promise<number> {
  const valorArredondado = parseFloat(item.valor.toFixed(2))
  const normDesc = normalizarDescricaoParaHash(item.descricao)

  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('descricao')
    .gte('valor', valorArredondado - 0.005)
    .lte('valor', valorArredondado + 0.005)
    .gte('data_compra', dataInicio)
    .lte('data_compra', dataFim)

  if (error?.message?.includes('data_compra')) {
    const { data: data2 } = await supabase
      .from('transacoes_nubank')
      .select('descricao')
      .gte('valor', valorArredondado - 0.005)
      .lte('valor', valorArredondado + 0.005)
      .gte('data', dataInicio)
      .lte('data', dataFim)
    return (data2 ?? []).filter(r => normalizarDescricaoParaHash(r.descricao) === normDesc).length
  }

  return (data ?? []).filter(r => normalizarDescricaoParaHash(r.descricao) === normDesc).length
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
  throw new Error('Erro ao salvar transações: ' + result.error.message)
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

  const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()
  const faturaStats: Record<string, StatsFatura> = {}
  for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

  for (const item of transacoes) {
    const stats = faturaStats[item.projeto_fatura]
    stats.noCSV++

    // Hash pre-check: se o hash já existe no banco, pula imediatamente
    const { count: hashCount } = await supabase
      .from('transacoes_nubank')
      .select('*', { count: 'exact', head: true })
      .eq('hash_linha', item.hash_linha)
    if ((hashCount ?? 0) > 0) {
      duplicatasIgnoradas++
      stats.ignoradas++
      continue
    }

    const dataInicio = adicionarDias(item.data_compra, -3)
    const dataFim = adicionarDias(item.data_compra, 3)

    const qtdNoBanco = await contarNoBanco(supabase, item, dataInicio, dataFim)

    // Count how many times this exact (descricao, valor, date, responsavel) appears in the CSV
    const qtdNoCsv = transacoes.filter(x =>
      x.descricao === item.descricao &&
      x.valor === item.valor &&
      x.data_compra === item.data_compra &&
      x.responsavel === item.responsavel
    ).length

    if (qtdNoBanco < qtdNoCsv) {
      const inserido = await inserirTransacao(supabase, item)
      if (inserido) {
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
    } else {
      duplicatasIgnoradas++
      stats.ignoradas++
    }
  }

  // Query DB total per fatura for duplicate validation
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
