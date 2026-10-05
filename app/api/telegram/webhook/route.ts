/**
 * Webhook do bot do Telegram.
 *
 * O Telegram espera resposta rápida e reenvia o update se não recebe 200 —
 * mas um turno do agente pode levar dezenas de segundos. Por isso a resposta
 * sai na hora e o processamento continua em `after()`, dentro do mesmo
 * maxDuration. Reentregas são descartadas pelo update_id.
 *
 * O webhook é registrado pelo próprio app (ver garantirWebhook em
 * lib/telegram/botApi.ts) com um segredo derivado do token do bot, conferido
 * aqui em cada update.
 *
 * Depois de responder, a mesma execução apaga do chat o que já venceu (e
 * espera o que vencer dentro do maxDuration — ver lib/telegram/autolimpeza.ts).
 * O resto fica para a rotina /api/telegram/limpeza.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { segredoValido, telegramConfigurado } from '@/lib/telegram/botApi'
import { processarUpdate, limparDedupe, type UpdateTelegram } from '@/lib/telegram/assessor'
import { apagarDentroDoPrazo } from '@/lib/telegram/autolimpeza'
import { criarSupabaseAdmin } from '@/lib/supabaseAdmin'

/** Turno (até 75 s) + folga para apagar o que vencer logo depois. */
export const maxDuration = 150
export const dynamic = 'force-dynamic'

/** Mesmo orçamento do chat do app, contado a partir da chegada do update. */
const ORCAMENTO_MS = 75_000
/** Até quando a execução pode esperar para apagar mensagens, com folga para o maxDuration. */
const LIMITE_LIMPEZA_MS = (maxDuration - 8) * 1000

export async function POST(req: NextRequest) {
  const chegada = Date.now()
  const deadlineMs = chegada + ORCAMENTO_MS

  if (!telegramConfigurado()) {
    return NextResponse.json({ error: 'Telegram não configurado' }, { status: 503 })
  }
  if (!segredoValido(req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Segredo inválido' }, { status: 401 })
  }

  let update: UpdateTelegram
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const admin = criarSupabaseAdmin()
  if (!admin) {
    console.error('[telegram] SUPABASE_SERVICE_ROLE_KEY não configurada — update ignorado')
    return NextResponse.json({ ok: true })
  }

  after(async () => {
    try {
      await processarUpdate(admin, update, deadlineMs)
    } catch (err) {
      console.error('[telegram] update:', err instanceof Error ? err.message : err)
    }
    try {
      await limparDedupe(admin)
    } catch { /* manutenção oportunista */ }
    try {
      await apagarDentroDoPrazo(admin, chegada + LIMITE_LIMPEZA_MS)
    } catch (err) {
      console.error('[telegram] limpeza:', err instanceof Error ? err.message : err)
    }
  })

  return NextResponse.json({ ok: true })
}
