import { NextRequest, NextResponse, after } from 'next/server'
import { criarSupabaseServer } from '@/lib/supabaseServer'
import {
  processarCSV,
  processarTransacoesJSON,
  TransacaoInputJSON,
  TransacaoNubank,
} from '@/lib/csvparser'
import { categorizarTransacoes } from '@/lib/categorizarTransacoes'
import { notificarImportacao } from '@/lib/pushImportacao'
import { conciliarTransacao, conciliarEstorno } from '@/lib/conciliacao'
import { validarDivergenciaFatura } from '@/lib/validacaoFatura'
import { sincronizarAssinaturasMoedaEstrangeira, AssinaturaSincronizada } from '@/lib/assinaturasSync'

export const maxDuration = 300

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

// A categorização por IA é lenta (lotes de 20 descrições com 5s de intervalo entre
// chamadas ao Gemini) e não deve bloquear a confirmação de recebimento do CSV.
// O import fica síncrono; a categorização é disparada em background via after() e
// rastreada em `categorization_jobs`, reaproveitando o mesmo mecanismo de job/polling
// já usado pelo botão "Categorizar com IA" (app/api/categorizar + /categorizar/status).
type CategorizacaoResposta =
  | { status: 'queued'; jobId: string | null; total: number }
  | { status: 'skipped'; motivo: string }
  | null

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

type DecisaoValidacao =
  | 'inserida' | 'duplicada' | 'conflito'
  | 'estorno_aplicado' | 'estorno_registrado' | 'estorno_ignorado'

interface LinhaValidacao {
  descricao: string
  valor: number
  data_compra: string
  decisao: DecisaoValidacao
  transacao_id: string | null
  dados_linha: Record<string, unknown>
  estado_anterior: Record<string, unknown> | null
  notificacao_id: string | null
}

// Payload cru da linha (sem occurrence_index, que não é persistido) — guardado para
// permitir reinserir a transação depois, caso o usuário reverta uma decisão manualmente.
function dadosLinhaDe(item: TransacaoNubank): Record<string, unknown> {
  const { occurrence_index: _oi, ...base } = item as TransacaoNubank & { occurrence_index?: number }
  return base
}

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
  const linhas: LinhaValidacao[] = []

  const mesesNoArquivo = [...new Set(transacoes.map(t => t.projeto_fatura))].sort()
  const faturaStats: Record<string, StatsFatura> = {}
  for (const f of mesesNoArquivo) faturaStats[f] = { noCSV: 0, inseridas: 0, ignoradas: 0, totalNoBanco: 0 }

  for (const item of transacoesNormais) {
    const stats = faturaStats[item.projeto_fatura]
    stats.noCSV++

    const resultado = await conciliarTransacao(supabase, item, 'api')
    const dadosLinha = dadosLinhaDe(item)
    const linhaBase = { descricao: item.descricao, valor: item.valor, data_compra: item.data_compra, dados_linha: dadosLinha }

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
          linhas.push({ ...linhaBase, decisao: 'inserida', transacao_id: resultado.transacaoId ?? null, estado_anterior: null, notificacao_id: null })
        } else {
          duplicatasIgnoradas++
          stats.ignoradas++
          linhas.push({ ...linhaBase, decisao: 'duplicada', transacao_id: resultado.matchExistenteId ?? null, estado_anterior: null, notificacao_id: null })
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
        linhas.push({ ...linhaBase, decisao: 'conflito', transacao_id: resultado.transacaoId ?? null, estado_anterior: null, notificacao_id: resultado.notificacaoId ?? null })
        break
      case 'ignorado':
        duplicatasIgnoradas++
        stats.ignoradas++
        linhas.push({ ...linhaBase, decisao: 'duplicada', transacao_id: resultado.matchExistenteId ?? null, estado_anterior: null, notificacao_id: null })
        break
    }
  }

  for (const estorno of estornos) {
    const resultado = await conciliarEstorno(supabase, estorno)
    const linhaBase = { descricao: estorno.descricao, valor: estorno.valor, data_compra: estorno.data_compra, dados_linha: dadosLinhaDe(estorno) }

    if (resultado.acao === 'aplicado') {
      estornosAplicados++
      linhas.push({
        ...linhaBase,
        decisao: 'estorno_aplicado',
        transacao_id: resultado.transacaoId ?? null,
        estado_anterior: resultado.originalId ? { original_id: resultado.originalId, status_anterior: resultado.statusAnteriorOriginal } : null,
        notificacao_id: null,
      })
    } else if (resultado.acao === 'registrado') {
      estornosRegistrados++
      linhas.push({ ...linhaBase, decisao: 'estorno_registrado', transacao_id: resultado.transacaoId ?? null, estado_anterior: null, notificacao_id: null })
    } else {
      linhas.push({ ...linhaBase, decisao: 'estorno_ignorado', transacao_id: null, estado_anterior: null, notificacao_id: null })
    }
  }

  // Push de sucesso: dispara assim que os dados que ele precisa (verdadeiramenteNovas,
  // conflitos, purchaseDates, estornos) já estão prontos — antes da recontagem por fatura,
  // de validarDivergenciaFatura e da sincronização de assinaturas, que não alimentam o
  // payload da notificação. Chamada síncrona (não after()): after() só dispara depois que
  // TODA a resposta HTTP termina de ser processada, então embrulhar aqui não adiantaria a
  // entrega — só faria esperar pelas mesmas três etapas de um jeito mais indireto.
  const importTs = Date.now()
  try {
    await notificarImportacao(supabase, 'sucesso', verdadeiramenteNovas, conflitos, cartao, undefined, {
      purchaseDates,
      projetoFaturas: mesesNoArquivo,
      importTs,
      estornosAplicados,
      estornosRegistrados,
    })
  } catch (err) {
    console.error('[nubank/importar] push sucesso falhou:', err)
  }

  let assinaturasAtualizadas: AssinaturaSincronizada[] = []
  try {
    for (const fatura of mesesNoArquivo) {
      const { count } = await supabase
        .from('transacoes_nubank')
        .select('*', { count: 'exact', head: true })
        .eq('projeto_fatura', fatura)
        .eq('cartao', cartao)
        .eq('is_estorno', false)
      faturaStats[fatura].totalNoBanco = count ?? 0
    }

    await validarDivergenciaFatura(supabase, faturaStats, transacoesNormais, cartao)

    assinaturasAtualizadas = await sincronizarAssinaturasMoedaEstrangeira(supabase, cartao, mesesNoArquivo)
  } catch (postImportError) {
    // Falha aqui não deve derrubar a resposta HTTP nem disparar um push de erro
    // contraditório — o push de sucesso acima já foi (ou está sendo) enviado.
    console.error('[nubank/importar] Falha pós-import (recontagem/validação/assinaturas):', postImportError)
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
    purchaseDates,
    estornosAplicados,
    estornosRegistrados,
    assinaturasAtualizadas,
    linhas,
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

  async function registrarLog(descricao: string, valor?: number): Promise<string | null> {
    try {
      const { data } = await supabase.from('activity_logs').insert({
        acao: 'importar',
        tabela: 'transacoes_nubank',
        descricao,
        valor: valor ?? null,
      }).select('id').single()
      return data?.id ?? null
    } catch {
      /* falha no log nunca deve interromper a resposta */
      return null
    }
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

    // purchaseDates e linhas são excluídos da resposta pública propositalmente: purchaseDates
    // só é usado pelo push (já disparado em background dentro de salvarTransacoes); linhas
    // carrega o payload interno de cada transação e vai só pra import_validacoes, não pro cliente.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hashesImportados, purchaseDates, linhas, ...importacaoPublica } = resultadoImportacao

    const mesesStr = importacaoPublica.mesesReprocessados.map(m => m.substring(0, 7)).join(', ')
    const logId = await registrarLog(
      `${importacaoPublica.novas} novas via API (${importacaoPublica.matheus}M + ${importacaoPublica.jeniffer}J)${mesesStr ? ' · ' + mesesStr : ''}`,
      parseFloat(importacaoPublica.total)
    )

    if (logId && linhas.length > 0) {
      try {
        await supabase.from('import_validacoes').insert(
          linhas.map(l => ({ ...l, log_id: logId }))
        )
      } catch (err) {
        console.error('[nubank/importar] Falha ao salvar detalhes de validação:', err)
      }
    }

    // Etapa 2 (assíncrona): o push de sucesso já foi disparado em background dentro de
    // salvarTransacoes (logo após o loop de estornos). A categorização por IA roda em
    // background após a resposta ser enviada.
    const deveCategorizar = url.searchParams.get('categorizar') !== 'false'
    let categorizacao: CategorizacaoResposta = null

    if (deveCategorizar) {
      const geminiKey = process.env.GEMINI_API_KEY
      if (!geminiKey) {
        categorizacao = { status: 'skipped', motivo: 'GEMINI_API_KEY não configurada no servidor.' }
      } else if (hashesImportados.length === 0) {
        categorizacao = { status: 'skipped', motivo: 'Nenhuma transação nova para categorizar.' }
      } else {
        const { data: job } = await supabase
          .from('categorization_jobs')
          .insert({ status: 'running', total: hashesImportados.length })
          .select('id')
          .single()
        const jobId: string | null = job?.id ?? null

        categorizacao = { status: 'queued', jobId, total: hashesImportados.length }

        after(async () => {
          try {
            const resultado = await categorizarTransacoes(supabase, geminiKey, hashesImportados, true)
            if (jobId) {
              await supabase.from('categorization_jobs').update({
                status: 'done',
                categorized: resultado.categorized,
                cota_diaria_esgotada: resultado.cotaDiariaEsgotada,
                erros: resultado.erros ?? null,
                finished_at: new Date().toISOString(),
              }).eq('id', jobId)
            }
          } catch (err) {
            console.error('[nubank/importar] Erro na categorização assíncrona:', err)
            if (jobId) {
              await supabase.from('categorization_jobs').update({
                status: 'error',
                erros: [String(err)],
                finished_at: new Date().toISOString(),
              }).eq('id', jobId)
            }
          }
        })
      }
    }

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
