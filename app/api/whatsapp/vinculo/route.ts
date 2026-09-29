/**
 * Vínculo do WhatsApp do usuário logado (tela de Configurações → Conta).
 *
 *   GET    estado atual: configuração do servidor, número vinculado, código pendente
 *   POST   gera um código de uso único para enviar pelo WhatsApp
 *   DELETE desvincula o número
 *
 * Usa a sessão do usuário: a política RLS de whatsapp_vinculos só deixa cada
 * um ler e alterar a própria linha.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { whatsappConfigurado, numeroExibicao } from '@/lib/whatsapp/cloudApi'
import {
  gerarCodigo,
  formatarCodigo,
  mascararTelefone,
  VALIDADE_CODIGO_MIN,
} from '@/lib/whatsapp/vinculo'

/** Nomes (nunca valores) das variáveis que faltam — para a tela orientar a configuração. */
function pendencias(): string[] {
  const faltando: string[] = []
  if (!whatsappConfigurado()) {
    for (const nome of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']) {
      if (!process.env[nome]) faltando.push(nome)
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) faltando.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.GEMINI_API_KEY) faltando.push('GEMINI_API_KEY')
  return faltando
}

function tabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return erro.code === '42P01' || erro.code === 'PGRST205' || /whatsapp_vinculos/.test(erro.message ?? '')
}

function linkWaMe(numero: string | null, codigo: string): string | null {
  if (!numero) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(`vincular ${formatarCodigo(codigo)}`)}`
}

export async function GET(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const faltando = pendencias()
  const numero = numeroExibicao()

  const { data, error } = await supabase
    .from('whatsapp_vinculos')
    .select('telefone, vinculado_em, codigo, codigo_expira_em')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    if (tabelaAusente(error)) {
      return NextResponse.json({ configurado: false, pendencias: faltando, migracaoPendente: true, numero })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const codigoValido =
    data?.codigo && data.codigo_expira_em && new Date(data.codigo_expira_em).getTime() > Date.now()

  return NextResponse.json({
    configurado: faltando.length === 0,
    pendencias: faltando,
    migracaoPendente: false,
    numero,
    vinculado: Boolean(data?.telefone),
    telefone: mascararTelefone(data?.telefone),
    vinculadoEm: data?.vinculado_em ?? null,
    codigo: codigoValido ? formatarCodigo(data!.codigo!) : null,
    codigoExpiraEm: codigoValido ? data!.codigo_expira_em : null,
    link: codigoValido ? linkWaMe(numero, data!.codigo!) : null,
  })
}

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000).toISOString()

  // Colisão de código é astronomicamente rara, mas o UNIQUE a transformaria
  // num erro para o usuário — uma segunda tentativa resolve.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const codigo = gerarCodigo()
    const { error } = await supabase
      .from('whatsapp_vinculos')
      .upsert(
        { user_id: user.id, email: user.email ?? null, codigo, codigo_expira_em: expiraEm },
        { onConflict: 'user_id' }
      )

    if (!error) {
      const numero = numeroExibicao()
      return NextResponse.json({
        codigo: formatarCodigo(codigo),
        codigoExpiraEm: expiraEm,
        link: linkWaMe(numero, codigo),
        numero,
      })
    }
    if (tabelaAusente(error)) {
      return NextResponse.json(
        { error: 'Tabela whatsapp_vinculos não existe. Rode supabase/migration_whatsapp.sql no Supabase.' },
        { status: 500 }
      )
    }
    if (error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Não foi possível gerar o código. Tente de novo.' }, { status: 500 })
}

export async function DELETE(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { error } = await supabase
    .from('whatsapp_vinculos')
    .update({ telefone: null, conversation_id: null, codigo: null, codigo_expira_em: null, vinculado_em: null })
    .eq('user_id', user.id)

  if (error && !tabelaAusente(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
