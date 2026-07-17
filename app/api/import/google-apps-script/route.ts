import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export const maxDuration = 60

const CARTOES_VALIDOS = ['nubank', 'cartao1', 'cartao2'] as const
type CartaoValido = typeof CARTOES_VALIDOS[number]

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireAuth(req)
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

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cartao }),
    })

    const texto = await response.text()
    let resultado: unknown = texto
    try { resultado = JSON.parse(texto) } catch { /* resposta não é JSON, mantém texto puro */ }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'O Web App do Google Apps Script retornou um erro.', detalhe: resultado },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true, resultado })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Falha ao acionar o Web App do Google Apps Script: ' + msg }, { status: 500 })
  }
}
