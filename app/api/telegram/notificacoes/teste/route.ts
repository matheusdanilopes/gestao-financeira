/**
 * POST /api/telegram/notificacoes/teste
 * Manda um aviso de teste para o Telegram conectado do próprio usuário.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { telegramConfigurado, TelegramError } from '@/lib/telegram/botApi'
import { enviarAvisoTelegram } from '@/lib/telegram/notificacoes'

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  if (!telegramConfigurado()) {
    return NextResponse.json({ error: 'Bot do Telegram não configurado (TELEGRAM_BOT_TOKEN).' }, { status: 503 })
  }

  const { data } = await supabase
    .from('telegram_vinculos')
    .select('chat_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data?.chat_id) {
    return NextResponse.json({ error: 'Conecte o Telegram primeiro.' }, { status: 404 })
  }

  try {
    await enviarAvisoTelegram(Number(data.chat_id), {
      titulo: '🔔 Notificação de teste',
      corpo: 'Os avisos do app estão chegando por aqui. Escolha quais receber em Configurações → Conta → Assessor no Telegram.',
      caminho: '/configuracoes',
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof TelegramError && err.codigo === 403) {
      return NextResponse.json(
        { error: 'O Telegram recusou: o bot foi bloqueado ou a conversa foi apagada. Abra a conversa com o bot e toque em Iniciar.' },
        { status: 409 }
      )
    }
    console.error('[telegram] teste:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Falha ao enviar a notificação de teste.' }, { status: 500 })
  }
}
