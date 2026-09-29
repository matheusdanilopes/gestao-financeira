/**
 * Webhook da WhatsApp Cloud API (Meta).
 *
 *   GET  verificação do webhook (hub.challenge), feita uma vez ao configurar
 *   POST mensagens recebidas → assessor financeiro responde pelo WhatsApp
 *
 * A Meta espera 200 em poucos segundos e reenvia o evento se não receber —
 * mas um turno do agente pode levar dezenas de segundos. Por isso a resposta
 * sai na hora e o processamento continua em `after()`, dentro do mesmo
 * maxDuration. Reentregas são descartadas pelo id da mensagem.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { assinaturaValida, whatsappConfigurado } from '@/lib/whatsapp/cloudApi'
import { processarMensagem, limparDedupe, type MensagemRecebida } from '@/lib/whatsapp/assessor'
import { criarSupabaseAdmin } from '@/lib/supabaseAdmin'

export const maxDuration = 90
export const dynamic = 'force-dynamic'

/** Mesmo orçamento do chat do app, contado a partir da chegada do webhook. */
const ORCAMENTO_MS = 75_000

/** Aviso de entrega de uma mensagem que NÓS enviamos (sent, delivered, read, failed). */
interface StatusEntrega {
  id?: string
  status?: string
  recipient_id?: string
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

interface PayloadWebhook {
  object?: string
  entry?: Array<{
    changes?: Array<{
      field?: string
      value?: {
        metadata?: { phone_number_id?: string }
        messages?: MensagemRecebida[]
        statuses?: StatusEntrega[]
      }
    }>
  }>
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const token = process.env.WHATSAPP_VERIFY_TOKEN
  if (
    token &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === token
  ) {
    return new Response(params.get('hub.challenge') ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return NextResponse.json({ error: 'Token de verificação inválido' }, { status: 403 })
}

export async function POST(req: NextRequest) {
  const deadlineMs = Date.now() + ORCAMENTO_MS

  if (!whatsappConfigurado()) {
    return NextResponse.json({ error: 'WhatsApp não configurado' }, { status: 503 })
  }

  const corpo = await req.text()
  if (!assinaturaValida(corpo, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 })
  }

  let payload: PayloadWebhook
  try {
    payload = JSON.parse(corpo)
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const meuNumero = process.env.WHATSAPP_PHONE_NUMBER_ID
  const mensagens: MensagemRecebida[] = []
  for (const entrada of payload.entry ?? []) {
    for (const mudanca of entrada.changes ?? []) {
      if (mudanca.field !== 'messages') continue
      // O mesmo app da Meta pode ter outros números; só respondemos pelo nosso.
      if (mudanca.value?.metadata?.phone_number_id !== meuNumero) continue
      mensagens.push(...(mudanca.value?.messages ?? []))

      // O envio pode ser aceito pela API e falhar depois, na entrega ao
      // celular — a Meta só avisa por aqui. Sem este log, a resposta some em
      // silêncio e não há como saber o motivo.
      for (const st of mudanca.value?.statuses ?? []) {
        if (st.status !== 'failed') continue
        const erros = (st.errors ?? [])
          .map(e => `${e.code ?? '?'} ${e.title ?? e.message ?? ''}${e.error_data?.details ? ` — ${e.error_data.details}` : ''}`)
          .join('; ')
        console.error(`[whatsapp] entrega falhou para ${st.recipient_id ?? '?'}: ${erros || 'sem detalhes'}`)
      }
    }
  }

  // Eventos de status (entregue, lido…) chegam aqui também e não pedem nada.
  if (mensagens.length === 0) return NextResponse.json({ ok: true })

  const admin = criarSupabaseAdmin()
  if (!admin) {
    console.error('[whatsapp] SUPABASE_SERVICE_ROLE_KEY não configurada — mensagem ignorada')
    return NextResponse.json({ ok: true })
  }

  after(async () => {
    // Em sequência: mensagens do mesmo número dependem da ordem (uma proposta
    // e depois o "sim" que a confirma).
    for (const msg of mensagens) {
      try {
        await processarMensagem(admin, msg, deadlineMs)
      } catch (err) {
        console.error('[whatsapp] mensagem:', err instanceof Error ? err.message : err)
      }
    }
    try {
      await limparDedupe(admin)
    } catch { /* manutenção oportunista */ }
  })

  return NextResponse.json({ ok: true })
}
