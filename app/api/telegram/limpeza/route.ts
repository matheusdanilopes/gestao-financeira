/**
 * Rotina periódica da limpeza do chat do Telegram.
 *
 * Apaga o que ficou pendente na fila (falhas reagendadas, mensagens com
 * botões, execuções do webhook que não esperaram o atraso) e tira da tabela
 * os registros antigos. O webhook já apaga no prazo; isto é a rede de
 * segurança.
 *
 * Quem chama:
 *   - Vercel Cron (GET, uma vez por dia) com Authorization: Bearer CRON_SECRET
 *   - pg_cron do Supabase (POST, a cada minuto, só quando há exclusão vencida)
 *     com Authorization: Bearer TELEGRAM_LIMPEZA_SECRET — ver
 *     supabase/cron_telegram_limpeza.sql
 *
 * Sem nenhum dos dois segredos configurado, a rota fica fechada.
 */

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { telegramConfigurado } from '@/lib/telegram/botApi'
import { apagarVencidas, limparRegistrosAntigos } from '@/lib/telegram/autolimpeza'
import { limparDedupe } from '@/lib/telegram/assessor'
import { criarSupabaseAdmin } from '@/lib/supabaseAdmin'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

function mesmoSegredo(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

function autorizado(req: NextRequest): boolean {
  const cabecalho = req.headers.get('authorization') ?? ''
  if (!cabecalho.startsWith('Bearer ')) return false
  const recebido = cabecalho.slice(7)
  return [process.env.CRON_SECRET, process.env.TELEGRAM_LIMPEZA_SECRET]
    .some(segredo => Boolean(segredo) && mesmoSegredo(recebido, segredo as string))
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!telegramConfigurado()) {
    return NextResponse.json({ error: 'Telegram não configurado' }, { status: 503 })
  }
  const admin = criarSupabaseAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' }, { status: 503 })
  }

  // Folga para gravar o resultado antes do maxDuration.
  const resumo = await apagarVencidas(admin, Date.now() + (maxDuration - 10) * 1000)
  const registrosRemovidos = await limparRegistrosAntigos(admin)
  await limparDedupe(admin).catch(() => undefined)

  return NextResponse.json({ ok: true, ...resumo, registrosRemovidos })
}

// O Vercel Cron chama com GET.
export const GET = POST
