import { NextRequest, NextResponse, after } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export const maxDuration = 60

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

interface ArquivoDetalhe {
  assunto: string | null
  arquivo: string | null
  enviado: boolean
  tentativas?: number
  erro: string | null
}

interface ResumoImportacao {
  emailsEncontrados: number
  arquivoEncontrado: boolean
  totalArquivosCsv: number
  arquivosEnviadosComSucesso: number
  arquivosComFalha: number
  detalhes: ArquivoDetalhe[]
  sucessoGeral: boolean
}

interface ExecucaoStatus {
  status: 'running' | 'success' | 'error'
  origem: 'api' | 'job'
  iniciadoEm: string
  finalizadoEm: string | null
  resumo?: ResumoImportacao
  erro?: string
}

// Corpo devolvido pelo Web App do Apps Script. O campo "status" no nível raiz
// é o HTTP status code; após o JSON.parse só sobra a última chave repetida
// ("status"), que é o objeto ExecucaoStatus aninhado — por isso o código
// sempre usa response.status (HTTP real) para o código numérico.
interface RespostaAppsScript {
  sucesso?: boolean
  mensagem?: string
  erro?: string
  emExecucao?: boolean
  arquivoEncontrado?: boolean
  envioComSucesso?: boolean
  resumo?: ResumoImportacao
  status?: ExecucaoStatus | null
}

// Consulta rápida (não dispara nada) para saber se já existe uma execução em andamento.
// Lê como texto primeiro (em vez de response.json() direto) para conseguir devolver o
// corpo bruto quando não for JSON válido — essencial pra diagnosticar (ex.: o Apps
// Script devolvendo uma página de erro/HTML em vez do JSON esperado).
async function consultarStatusScript(scriptUrl: string, token?: string) {
  const url = new URL(scriptUrl)
  url.searchParams.set('action', 'status')
  if (token) url.searchParams.set('token', token)
  const response = await fetch(url.toString())
  const raw = await response.text()
  let data: RespostaAppsScript | null = null
  try {
    data = JSON.parse(raw)
  } catch { /* corpo não é JSON — data fica null, raw carrega o diagnóstico */ }
  return { httpStatus: response.status, data, raw }
}

export async function GET(req: NextRequest) {
  const { unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_IMPORT_URL
  if (!scriptUrl) {
    return NextResponse.json(
      { error: 'GOOGLE_APPS_SCRIPT_IMPORT_URL não configurada no servidor.' },
      { status: 500 }
    )
  }
  const scriptToken = process.env.GOOGLE_APPS_SCRIPT_IMPORT_TOKEN

  try {
    const { httpStatus, data, raw } = await consultarStatusScript(scriptUrl, scriptToken)
    if (!data) {
      return NextResponse.json(
        { erro: `O Google Apps Script devolveu uma resposta que não é JSON (HTTP ${httpStatus}).`, corpoBruto: raw.slice(0, 800) },
        { status: httpStatus || 502 }
      )
    }
    if (httpStatus === 401 && !scriptToken) {
      return NextResponse.json(
        { ...data, erro: `${data.erro ?? 'Token inválido ou ausente.'} (GOOGLE_APPS_SCRIPT_IMPORT_TOKEN não está configurada no servidor.)` },
        { status: httpStatus }
      )
    }
    return NextResponse.json(data, { status: httpStatus })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ erro: `Falha ao consultar status do Google Apps Script: ${msg}` }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_IMPORT_URL
  if (!scriptUrl) {
    return NextResponse.json(
      { error: 'GOOGLE_APPS_SCRIPT_IMPORT_URL não configurada no servidor.' },
      { status: 500 }
    )
  }
  const scriptToken = process.env.GOOGLE_APPS_SCRIPT_IMPORT_TOKEN

  let cartao: string = 'nubank'
  try {
    const body = await req.json()
    if (typeof body?.cartao === 'string' && body.cartao) cartao = body.cartao
  } catch { /* body é opcional */ }

  if (!CARTOES_VALIDOS.includes(cartao as CartaoValido)) {
    return NextResponse.json(
      { error: `Cartão inválido: "${cartao}". Use um de: ${CARTOES_VALIDOS.join(', ')}.` },
      { status: 400 }
    )
  }

  // Checagem rápida antes de disparar: evita empilhar uma nova execução em cima de
  // uma que já esteja rodando (seja via API, seja via gatilho de tempo do Apps Script).
  try {
    const { httpStatus, data } = await consultarStatusScript(scriptUrl, scriptToken)
    if (httpStatus === 409 || data?.status?.status === 'running') {
      return NextResponse.json(
        {
          success: false,
          emExecucao: true,
          mensagem: data?.mensagem ?? 'Já existe uma execução em andamento. Aguarde a conclusão antes de tentar novamente.',
          status: data?.status ?? null,
        },
        { status: 409 }
      )
    }
    // Token inválido/ausente é erro de configuração, não algo que o disparo em
    // background resolveria — falha rápido em vez de tentar (e falhar de novo) depois.
    if (httpStatus === 401) {
      const dica = !scriptToken ? ' (GOOGLE_APPS_SCRIPT_IMPORT_TOKEN não está configurada no servidor.)' : ''
      return NextResponse.json(
        { success: false, error: `${data?.erro ?? 'Token inválido ao autenticar no Google Apps Script.'}${dica}` },
        { status: 401 }
      )
    }
  } catch {
    // Se a checagem de status falhar (ex.: rede), segue com o disparo normalmente —
    // o próprio Apps Script recusa com 409 se já estiver rodando.
  }

  // O Web App do Apps Script lê a planilha e envia os dados para /api/nubank/importar —
  // isso pode ultrapassar o timeout da function na plataforma de deploy. Disparamos em
  // background via after() e respondemos de imediato para o cliente nunca receber uma
  // página de erro de timeout no lugar de JSON. O andamento real (incluindo o resumo de
  // negócio) é acompanhado via polling de GET /api/import/google-apps-script (action=status).
  after(async () => {
    try {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scriptToken ? { cartao, token: scriptToken } : { cartao }),
      })
      if (response.status === 409) return

      const data: RespostaAppsScript | null = await response.json().catch(() => null)

      if (!response.ok) {
        await supabase.from('activity_logs').insert({
          acao: 'importar',
          tabela: 'transacoes_nubank',
          descricao: `ERRO: Google Apps Script retornou ${response.status}: ${data?.erro ?? 'erro desconhecido'}`,
        })
        return
      }

      // HTTP 200 ainda pode representar falha parcial/total no envio dos CSVs
      // encontrados — os arquivos que falharam nunca chegam a /api/nubank/importar,
      // então não geram log próprio. Registra aqui para manter o histórico completo.
      if (data?.envioComSucesso === false && (data.resumo?.arquivosComFalha ?? 0) > 0) {
        const falhas = data.resumo!.detalhes
          .filter(d => !d.enviado)
          .map(d => `${d.arquivo ?? d.assunto ?? 'arquivo'}: ${d.erro ?? 'erro desconhecido'}`)
          .join('; ')
        await supabase.from('activity_logs').insert({
          acao: 'importar',
          tabela: 'transacoes_nubank',
          descricao: `ERRO: Falha ao enviar ${data.resumo!.arquivosComFalha} de ${data.resumo!.totalArquivosCsv} arquivo(s) do Google Apps Script: ${falhas}`,
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      await supabase.from('activity_logs').insert({
        acao: 'importar',
        tabela: 'transacoes_nubank',
        descricao: `ERRO: Falha ao acionar o Web App do Google Apps Script: ${msg}`,
      })
    }
  })

  return NextResponse.json({ success: true, message: 'Disparo enviado ao Google Apps Script.' })
}
