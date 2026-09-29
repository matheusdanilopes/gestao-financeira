/**
 * Vínculo do Telegram do usuário logado (tela de Configurações → Conta).
 *
 *   GET    estado atual (e registra o webhook do bot, se ainda não estiver)
 *   POST   gera um código de uso único e o link t.me que o leva ao bot
 *   PATCH  salva quais notificações chegam pelo Telegram ({ notificacoes })
 *   DELETE desvincula o Telegram
 *
 * Usa a sessão do usuário: a política RLS de telegram_vinculos só deixa cada
 * um ler e alterar a própria linha.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { telegramConfigurado, usuarioDoBot, garantirWebhook } from '@/lib/telegram/botApi'
import { gerarCodigo, VALIDADE_CODIGO_MIN } from '@/lib/telegram/vinculo'
import { sanitizarPreferencias, type PreferenciasNotificacaoTelegram } from '@/lib/telegram/categoriasNotificacao'

/** Nomes (nunca valores) das variáveis que faltam — para a tela orientar a configuração. */
function pendencias(): string[] {
  const faltando: string[] = []
  if (!telegramConfigurado()) faltando.push('TELEGRAM_BOT_TOKEN')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) faltando.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.GEMINI_API_KEY) faltando.push('GEMINI_API_KEY')
  return faltando
}

function tabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return erro.code === '42P01' || erro.code === 'PGRST205' || /telegram_vinculos/.test(erro.message ?? '')
}

/**
 * URL pública do webhook. Prefere o domínio de produção fixo da Vercel, para
 * o registro não ficar alternando entre aliases; em previews não registra
 * nada — senão abrir um preview roubaria o bot da produção.
 */
function urlWebhook(req: NextRequest): string | null {
  if (process.env.VERCEL_ENV === 'preview') return null
  const explicita = process.env.TELEGRAM_WEBHOOK_URL
  if (explicita) return explicita
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? req.headers.get('host')
  if (!host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return null
  return `https://${host}/api/telegram/webhook`
}

/** Coluna de migration_telegram_notificacoes.sql ainda não criada. */
function colunaNotificacoesAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return erro.code === '42703' || erro.code === 'PGRST204' || /notificacoes/.test(erro.message ?? '')
}

function link(bot: string | null, codigo: string): string | null {
  return bot ? `https://t.me/${bot}?start=${codigo}` : null
}

export async function GET(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const faltando = pendencias()
  let bot: string | null = null
  let erroWebhook: string | null = null

  if (telegramConfigurado()) {
    bot = await usuarioDoBot()
    if (!bot) {
      erroWebhook = 'O Telegram recusou o TELEGRAM_BOT_TOKEN. Confira o token no @BotFather.'
    } else {
      const url = urlWebhook(req)
      if (url) {
        try {
          await garantirWebhook(url)
        } catch (err) {
          erroWebhook = err instanceof Error ? err.message : 'Falha ao registrar o webhook do bot.'
          console.error('[telegram] webhook:', erroWebhook)
        }
      }
    }
  }

  const colunas = 'chat_id, telegram_nome, vinculado_em, codigo, codigo_expira_em'
  let notificacoesMigracaoPendente = false
  let { data, error } = await supabase
    .from('telegram_vinculos')
    .select(`${colunas}, notificacoes`)
    .eq('user_id', user.id)
    .maybeSingle<{
      chat_id: number | null
      telegram_nome: string | null
      vinculado_em: string | null
      codigo: string | null
      codigo_expira_em: string | null
      notificacoes?: PreferenciasNotificacaoTelegram | null
    }>()

  if (colunaNotificacoesAusente(error)) {
    notificacoesMigracaoPendente = true
    ;({ data, error } = await supabase
      .from('telegram_vinculos')
      .select(colunas)
      .eq('user_id', user.id)
      .maybeSingle())
  }

  if (error) {
    if (tabelaAusente(error)) {
      return NextResponse.json({ configurado: false, pendencias: faltando, migracaoPendente: true, bot })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const codigoValido =
    data?.codigo && data.codigo_expira_em && new Date(data.codigo_expira_em).getTime() > Date.now()

  return NextResponse.json({
    configurado: faltando.length === 0 && Boolean(bot),
    pendencias: faltando,
    migracaoPendente: false,
    erro: erroWebhook,
    bot,
    vinculado: Boolean(data?.chat_id),
    telegramNome: data?.telegram_nome ?? null,
    vinculadoEm: data?.vinculado_em ?? null,
    codigoExpiraEm: codigoValido ? data!.codigo_expira_em : null,
    link: codigoValido ? link(bot, data!.codigo!) : null,
    notificacoes: sanitizarPreferencias(data?.notificacoes),
    notificacoesMigracaoPendente,
  })
}

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const bot = await usuarioDoBot()
  if (!bot) {
    return NextResponse.json({ error: 'Bot do Telegram não configurado (TELEGRAM_BOT_TOKEN).' }, { status: 503 })
  }

  const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000).toISOString()

  // Colisão de código é astronomicamente rara, mas o UNIQUE a transformaria
  // num erro para o usuário — uma segunda tentativa resolve.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const codigo = gerarCodigo()
    const { error } = await supabase
      .from('telegram_vinculos')
      .upsert(
        { user_id: user.id, email: user.email ?? null, codigo, codigo_expira_em: expiraEm },
        { onConflict: 'user_id' }
      )

    if (!error) {
      return NextResponse.json({ codigoExpiraEm: expiraEm, link: link(bot, codigo), bot })
    }
    if (tabelaAusente(error)) {
      return NextResponse.json(
        { error: 'Tabela telegram_vinculos não existe. Rode supabase/migration_telegram.sql no Supabase.' },
        { status: 500 }
      )
    }
    if (error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Não foi possível gerar o link. Tente de novo.' }, { status: 500 })
}

export async function PATCH(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  let corpo: { notificacoes?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const notificacoes = sanitizarPreferencias(corpo.notificacoes)

  const { data, error } = await supabase
    .from('telegram_vinculos')
    .update({ notificacoes })
    .eq('user_id', user.id)
    .select('notificacoes')
    .maybeSingle()

  if (colunaNotificacoesAusente(error)) {
    return NextResponse.json(
      { error: 'Rode supabase/migration_telegram_notificacoes.sql no Supabase para escolher as notificações.' },
      { status: 500 }
    )
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Conecte o Telegram primeiro.' }, { status: 404 })

  return NextResponse.json({ notificacoes: sanitizarPreferencias(data.notificacoes) })
}

export async function DELETE(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { error } = await supabase
    .from('telegram_vinculos')
    .update({
      chat_id: null,
      telegram_nome: null,
      conversation_id: null,
      codigo: null,
      codigo_expira_em: null,
      vinculado_em: null,
    })
    .eq('user_id', user.id)

  if (error && !tabelaAusente(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
