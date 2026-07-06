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
import { conciliarTransacao, conciliarEstorno } from '@/lib/conciliacao'
import { validarDivergenciaFatura } from '@/lib/validacaoFatura'

export const maxDuration = 300

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

type AuthResult =
  | { ok: true }
  | { ok: false; status: 401; message: string }

async function autenticar(req: NextRequest): Promise<AuthResult> {
  const apiKey = process.env.NUBANK_IMPORT_API_KEY

  if (apiKey) {
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

  // Fallback: autenticação por sessão do Supabase quando NUBANK_IMPORT_API_KEY não está configurada
  const supabase = criarSupabaseServer(req)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return {
      ok: false,
      status: 401,
      message: 'Não autenticado. Configure NUBANK_IMPORT_API_KEY no servidor ou autentique-se via sessão.',
    }
  }

  return { ok: true }
}

type StatsFatura = { noCSV: number; inseridas: number; ignoradas: number; totalNoBanco: number }

async function salvarTransacoes(
  supabase: ReturnType<typeof criarSupabaseServer>,
  transacoes: TransacaoNubank[],
  cartao: string = 'nubank'
) {
  const transacoesNormais = transacoes.filter(t => !t.is_estorno)
  const estornos = transacoes.filter(t => t.is_estorno)

  let novosMatheus = 0
  let novosJeniffer = 0
  let totalValor = 0
  const hashesImportados: string[] = []
  const purchaseDates: string[] = []
  let verdadeiramenteNovas = 0
  let duplicatasIgnoradas = 0
  let conciliados = 0
  let conflitos = 0
  let estornosAplicados = 0
  let estornosRegistrados = 0

  const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()
  const faturaStats: Record<string, StatsFatura> = {}
  for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

  for (const item of transacoesNormais) {
    const stats = faturaStats[item.projeto_fatura]
    stats.noCSV++

    const resultado = await conciliarTransacao(supabase, item, 'api')

    switch (resultado.acao) {
      case 'inserido':
        if (resultado.inseriu) {
          verdadeiramenteNovas++
          hashesImportados.push(item.hash_linha)
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
      .eq('cartao', cartao)
    faturaStats[fatura].totalNoBanco = count ?? 0
  }

  await validarDivergenciaFatura(supabase, faturaStats, transacoesNormais, cartao)

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
    purchaseDates,
    estornosAplicados,
    estornosRegistrados,
  }
}

export async function POST(req: NextRequest) {
  const auth = await autenticar(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  const supabase = criarSupabaseServer(req)

  const url = new URL(req.url)
  let cartao: string = url.searchParams.get('cartao') ?? 'nubank'
  if (!CARTOES_VALIDOS.includes(cartao as CartaoValido)) {
    return NextResponse.json(
      { error: `Cartão inválido: "${cartao}". Use um de: ${CARTOES_VALIDOS.join(', ')}.` },
      { status: 400 }
    )
  }

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
    const get = (chave: string, fallback: string) =>
      configs?.find((c: { chave: string; valor: string }) => c.chave === chave)?.valor ?? fallback

    const diaVencimento = parseInt(get(`dia_vencimento_${cartao}`, get('dia_vencimento', '10')))
    const ajusteFechamento = parseInt(get(`ajuste_fechamento_${cartao}`, get('ajuste_fechamento', '0')))

    const contentType = req.headers.get('content-type') ?? ''
    let transacoes: TransacaoNubank[]

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const cartaoField = formData.get('cartao')
      if (typeof cartaoField === 'string' && cartaoField) {
        if (!CARTOES_VALIDOS.includes(cartaoField as CartaoValido)) {
          return NextResponse.json(
            { error: `Cartão inválido: "${cartaoField}". Use um de: ${CARTOES_VALIDOS.join(', ')}.` },
            { status: 400 }
          )
        }
        cartao = cartaoField
      }
      const file = formData.get('file') as File | null
      if (!file) {
        const msg = 'Campo "file" ausente no formulário.'
        await registrarLog(`ERRO: ${msg}`)
        await notificarImportacao(supabase, 'erro', undefined, undefined, cartao)
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      const csvText = await file.text()
      transacoes = processarCSV(csvText, diaVencimento, ajusteFechamento, cartao)
    } else {
      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        const msg = 'Body inválido: esperado JSON ou multipart/form-data com campo "file".'
        await registrarLog(`ERRO: ${msg}`)
        await notificarImportacao(supabase, 'erro', undefined, undefined, cartao)
        return NextResponse.json({ error: msg }, { status: 400 })
      }

      if (typeof body?.cartao === 'string' && body.cartao) {
        if (!CARTOES_VALIDOS.includes(body.cartao as CartaoValido)) {
          return NextResponse.json(
            { error: `Cartão inválido: "${body.cartao}". Use um de: ${CARTOES_VALIDOS.join(', ')}.` },
            { status: 400 }
          )
        }
        cartao = body.cartao
      }

      if (typeof body?.csv === 'string') {
        transacoes = processarCSV(body.csv, diaVencimento, ajusteFechamento, cartao)
      } else if (Array.isArray(body?.transacoes)) {
        transacoes = processarTransacoesJSON(
          body.transacoes as TransacaoInputJSON[],
          diaVencimento,
          ajusteFechamento,
          cartao
        )
      } else {
        const msg = 'Body deve conter "csv" (string com conteúdo CSV) ou "transacoes" (array de objetos).'
        await registrarLog(`ERRO: ${msg}`)
        await notificarImportacao(supabase, 'erro', undefined, undefined, cartao)
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    if (transacoes.length === 0) {
      const msg = 'Nenhuma transação válida encontrada. Verifique o formato do CSV.'
      await registrarLog(`ERRO: ${msg}`)
      await notificarImportacao(supabase, 'erro', undefined, undefined, cartao)
      return NextResponse.json({ success: false, error: msg }, { status: 422 })
    }

    const resultadoImportacao = await salvarTransacoes(supabase, transacoes, cartao)

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

    const { hashesImportados: _, purchaseDates, ...importacaoPublica } = resultadoImportacao

    const mesesStr = importacaoPublica.mesesReprocessados.map(m => m.substring(0, 7)).join(', ')
    await registrarLog(
      `${importacaoPublica.novas} novas via API (${importacaoPublica.matheus}M + ${importacaoPublica.jeniffer}J)${mesesStr ? ' · ' + mesesStr : ''}`,
      parseFloat(importacaoPublica.total)
    )

    const importTs = Date.now()
    await notificarImportacao(supabase, 'sucesso', importacaoPublica.novas, importacaoPublica.conflitos, cartao, undefined, {
      purchaseDates,
      projetoFaturas: importacaoPublica.mesesReprocessados,
      importTs,
      estornosAplicados: importacaoPublica.estornosAplicados,
      estornosRegistrados: importacaoPublica.estornosRegistrados,
    })

    return NextResponse.json({
      success: true,
      importacao: importacaoPublica,
      categorizacao,
    })
  } catch (error) {
    console.error('[nubank/importar] Exceção:', error)
    const msg = error instanceof Error ? error.message : String(error)
    await registrarLog(`ERRO: ${msg}`)
    await notificarImportacao(supabase, 'erro', undefined, undefined, cartao, undefined, { importTs: Date.now() })
    return NextResponse.json({ error: 'Erro interno: ' + msg }, { status: 500 })
  }
}
