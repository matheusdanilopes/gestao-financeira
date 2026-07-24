import webpush from 'web-push'
import { SupabaseClient, createClient } from '@supabase/supabase-js'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? 'mailto:admin@gestaofinanceira.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

// Cliente sem sessão para leitura de push_subscriptions — necessário para
// importações via API key onde não há cookies de autenticação no request.
const supabasePush = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_anon_key ?? ''
)

const LABELS_PADRAO: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

export function labelCartao(cartao: string, nomeCartao?: string): string {
  return nomeCartao || LABELS_PADRAO[cartao] || cartao
}

/** Contexto da importação para construir o deep link da notificação. */
export interface ContextoImportacao {
  /** Datas de compra (data_compra, YYYY-MM-DD) das transações inseridas. */
  purchaseDates?: string[]
  /** Valores de projeto_fatura (YYYY-MM-DD) das transações inseridas — para navegar ao mês correto. */
  projetoFaturas?: string[]
  /** Timestamp (Date.now()) do início da importação — repassado à tela de Compras. */
  importTs?: number
  /** Estornos vinculados a uma compra original (status ESTORNADO aplicado). */
  estornosAplicados?: number
  /** Estornos sem compra original encontrada (registrados isoladamente). */
  estornosRegistrados?: number
}

/**
 * Constrói a URL de deep link para a tela de Compras.
 * Rota erros para /importar, sucessos para /compras com mes (quando identificável) + ts.
 * Não aplica filtro de cartão/dia: a tela apresenta as compras novas via tag "Nova"
 * (individualizada por usuário), sem restringir a lista.
 */
function buildDeepLinkUrl(ctx: ContextoImportacao): string {
  const params = new URLSearchParams()
  params.set('ts', String(ctx.importTs ?? Date.now()))

  const faturas = ctx.projetoFaturas ?? []
  if (faturas.length > 0) {
    const freq: Record<string, number> = {}
    for (const f of faturas) {
      const key = f.substring(0, 7)
      freq[key] = (freq[key] ?? 0) + 1
    }
    const primaryMes = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
    params.set('mes', primaryMes)
  }

  return `/compras?${params.toString()}`
}

export async function notificarImportacao(
  supabase: SupabaseClient,
  tipo: 'sucesso' | 'erro',
  novas?: number,
  conflitos?: number,
  cartao: string = 'nubank',
  nomeCartao?: string,
  contexto?: ContextoImportacao
) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

  const nome = labelCartao(cartao, nomeCartao)
  let title: string
  let body: string
  // "Quão informativo" é o resultado — usado pelo SW para decidir se uma notificação
  // pode sobrescrever outra com a mesma tag (mesmo cartão). Uma importação que não
  // acha nada novo (score 0) não deve apagar do tray um resultado anterior mais
  // relevante (ex.: duas execuções da rota de import para o mesmo cartão em sequência,
  // como upload manual + gatilho assíncrono do Apps Script, ou retry de webhook).
  let score = 0

  if (tipo === 'sucesso') {
    const temNovas = (novas ?? 0) > 0
    const temConflitos = (conflitos ?? 0) > 0
    const estornosAplicados = contexto?.estornosAplicados ?? 0
    const estornosRegistrados = contexto?.estornosRegistrados ?? 0
    const temEstornos = estornosAplicados > 0 || estornosRegistrados > 0
    score = (temNovas ? 2 : 0) + (temConflitos ? 1 : 0) + (temEstornos ? 1 : 0)

    if (temNovas) {
      const n = novas!
      title = `${nome} — novas compras`
      body = `${n} nova${n !== 1 ? 's compras foram' : ' compra foi'} importada${n !== 1 ? 's' : ''} com sucesso.`
    } else if (temEstornos) {
      title = `${nome} — estorno detectado`
      body = 'Nenhuma compra nova.'
    } else {
      title = `${nome} — importação concluída`
      body = 'Nenhuma compra nova foi encontrada.'
    }

    if (temConflitos) {
      const c = conflitos!
      body += ` ${c} conflito${c !== 1 ? 's' : ''} de valor ${c !== 1 ? 'precisam' : 'precisa'} de revisão.`
    }

    if (estornosAplicados > 0) {
      body += ` ${estornosAplicados} estorno${estornosAplicados !== 1 ? 's aplicados' : ' aplicado'}.`
    }
    if (estornosRegistrados > 0) {
      body += ` ${estornosRegistrados} estorno${estornosRegistrados !== 1 ? 's sem' : ' sem'} compra correspondente.`
    }
  } else {
    title = `${nome} — importação não concluída`
    body = 'Algo deu errado na importação. Acesse o app para verificar o que aconteceu.'
  }

  // Tag única por cartão: cada cartão tem sua própria notificação independente.
  // Prefixo 'importacao-sucesso-' / 'importacao-erro-' permite ao SW fechar
  // todas as notificações de importação concluída via busca por prefixo.
  const tag = tipo === 'sucesso'
    ? `importacao-sucesso-${cartao}`
    : `importacao-erro-${cartao}`

  // Erros ou importações sem novas compras: /importar (resultado/diagnóstico).
  // Sucessos com novas compras: deep link para /compras apresentando as compras novas.
  const temNovasCompras = (novas ?? 0) > 0
  let url: string
  if (tipo === 'erro' || !temNovasCompras) {
    url = '/importar'
  } else if (contexto && ((contexto.purchaseDates?.length ?? 0) > 0 || (contexto.projetoFaturas?.length ?? 0) > 0)) {
    url = buildDeepLinkUrl(contexto)
  } else {
    url = `/compras?ts=${contexto?.importTs ?? Date.now()}`
  }

  const payload = {
    title,
    body,
    url,
    tag,
    score,
    requireInteraction: tipo === 'erro',
  }

  try {
    // Usa o cliente autenticado passado pela rota (tem sessão de usuário → passa na RLS).
    // Se não retornar subscriptions (rota sem sessão, ex: API key), tenta o cliente anon
    // como fallback para manter compatibilidade com importações automatizadas.
    let { data: subs } = await supabase.from('push_subscriptions').select('*')
    // Fallback apenas quando o cliente autenticado não retornou dados (RLS bloqueou — sem sessão).
    // Array vazio [] significa que o usuário não tem assinaturas e não deve acionar o fallback.
    let deleteClient: SupabaseClient = supabase
    if (subs === null || subs === undefined) {
      const { data: subsFallback } = await supabasePush.from('push_subscriptions').select('*')
      subs = subsFallback
      deleteClient = supabasePush
    }
    if (!subs?.length) return

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(sub.subscription, JSON.stringify(payload), {
          urgency: 'high',
          TTL: 86400,
        })
      )
    )

    const expiradas = subs
      .filter((_, i) => {
        const r = results[i]
        if (r.status !== 'rejected') return false
        const status = (r.reason as { statusCode?: number })?.statusCode
        return status === 410 || status === 404
      })
      .map(sub => sub.usuario)

    if (expiradas.length) {
      await deleteClient.from('push_subscriptions').delete().in('usuario', expiradas)
    }
  } catch { /* falha no push nunca deve interromper a resposta */ }
}
