/**
 * Cliente mínimo da WhatsApp Cloud API (Meta).
 *
 * Variáveis de ambiente:
 *   WHATSAPP_TOKEN            token de acesso (de preferência de usuário do sistema, sem expiração)
 *   WHATSAPP_PHONE_NUMBER_ID  id do número remetente (painel do app na Meta → WhatsApp → Configuração da API)
 *   WHATSAPP_APP_SECRET       chave secreta do app — valida a assinatura de cada webhook
 *   WHATSAPP_VERIFY_TOKEN     texto livre combinado com a Meta na verificação do webhook
 *   WHATSAPP_NUMERO           (opcional) número exibido no app para o link wa.me, só dígitos
 *   WHATSAPP_API_VERSION      (opcional) versão da Graph API, padrão v23.0
 */

import { createHmac, timingSafeEqual } from 'crypto'

const versao = () => process.env.WHATSAPP_API_VERSION || 'v23.0'
const graph = (caminho: string) => `https://graph.facebook.com/${versao()}/${caminho}`

/** Limite do WhatsApp é 4096 caracteres por mensagem de texto; sobra folga. */
export const LIMITE_MENSAGEM = 3500
/** Áudio embutido no Gemini tem teto de ~20 MB por requisição. */
const LIMITE_AUDIO_BYTES = 15 * 1024 * 1024

export function whatsappConfigurado(): boolean {
  return Boolean(
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_APP_SECRET &&
    process.env.WHATSAPP_VERIFY_TOKEN
  )
}

export function numeroExibicao(): string | null {
  const n = (process.env.WHATSAPP_NUMERO ?? '').replace(/\D/g, '')
  return n || null
}

/**
 * Confere o cabeçalho X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com o
 * app secret). Sem isso, qualquer um que descobrisse a URL do webhook poderia
 * se passar por um número vinculado e ler as finanças do casal.
 */
export function assinaturaValida(corpoCru: string, cabecalho: string | null): boolean {
  const segredo = process.env.WHATSAPP_APP_SECRET
  if (!segredo || !cabecalho?.startsWith('sha256=')) return false
  const esperado = createHmac('sha256', segredo).update(corpoCru, 'utf8').digest()
  let recebido: Buffer
  try {
    recebido = Buffer.from(cabecalho.slice('sha256='.length), 'hex')
  } catch {
    return false
  }
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

async function chamarMensagens(corpo: Record<string, unknown>): Promise<Response> {
  return fetch(graph(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
  })
}

/**
 * Celular brasileiro sem o nono dígito, como o webhook costuma informar
 * ("55 44 8815-9265") → com ele ("55 44 98815-9265"). Null se não for o caso.
 */
function comNonoDigito(numero: string): string | null {
  const m = numero.match(/^55(\d{2})([6-9]\d{7})$/)
  return m ? `55${m[1]}9${m[2]}` : null
}

async function postarTexto(para: string, texto: string): Promise<Response> {
  return chamarMensagens({
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { preview_url: false, body: texto },
  })
}

export async function enviarTexto(para: string, texto: string): Promise<void> {
  let res = await postarTexto(para, texto)
  let detalhe = res.ok ? '' : await res.text().catch(() => '')

  // O webhook entrega celulares do Brasil sem o nono dígito, mas a lista de
  // destinatários permitidos (número de teste da Meta) guarda o número com
  // ele — e para a Meta são números diferentes (erro 131030). Tentamos de novo
  // no formato com o 9.
  const alternativo = comNonoDigito(para)
  if (!res.ok && alternativo && detalhe.includes('131030')) {
    res = await postarTexto(alternativo, texto)
    detalhe = res.ok ? '' : await res.text().catch(() => '')
  }

  if (!res.ok) {
    throw new Error(`WhatsApp HTTP ${res.status}: ${detalhe.slice(0, 300)}`)
  }
}

/**
 * Marca a mensagem como lida e mostra "digitando…" enquanto o agente pensa
 * (o indicador some sozinho ao enviar a resposta ou após ~25 s). Falhar aqui
 * não importa — é só cortesia visual.
 */
export async function marcarLidaDigitando(messageId: string): Promise<void> {
  try {
    await chamarMensagens({
      status: 'read',
      message_id: messageId,
      typing_indicator: { type: 'text' },
    })
  } catch {
    /* indicador é opcional */
  }
}

/** Baixa uma mídia recebida (ex.: áudio de voz) e devolve em base64. */
export async function baixarMidia(mediaId: string): Promise<{ base64: string; mimeType: string } | null> {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }

  const meta = await fetch(graph(mediaId), { headers: auth })
  if (!meta.ok) return null
  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number }
  if (!info.url) return null
  if (info.file_size && info.file_size > LIMITE_AUDIO_BYTES) return null

  const arquivo = await fetch(info.url, { headers: auth })
  if (!arquivo.ok) return null
  const bytes = Buffer.from(await arquivo.arrayBuffer())
  if (bytes.length > LIMITE_AUDIO_BYTES) return null

  // "audio/ogg; codecs=opus" → "audio/ogg": o Gemini recusa o parâmetro.
  const mimeType = (info.mime_type ?? arquivo.headers.get('content-type') ?? 'audio/ogg').split(';')[0].trim()
  return { base64: bytes.toString('base64'), mimeType }
}
