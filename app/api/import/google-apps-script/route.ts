import { NextRequest, NextResponse, after } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export const maxDuration = 60

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

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

  // O Web App do Apps Script lê a planilha e envia os dados para /api/nubank/importar —
  // isso pode ultrapassar o timeout da function na plataforma de deploy. Disparamos em
  // background via after() e respondemos de imediato para o cliente nunca receber uma
  // página de erro de timeout no lugar de JSON.
  after(async () => {
    try {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartao }),
      })
      if (!response.ok) {
        const texto = await response.text()
        await supabase.from('activity_logs').insert({
          acao: 'importar',
          tabela: 'transacoes_nubank',
          descricao: `ERRO: Google Apps Script retornou ${response.status}: ${texto.slice(0, 300)}`,
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
