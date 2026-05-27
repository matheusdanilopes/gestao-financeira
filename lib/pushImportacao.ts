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

function labelCartao(cartao: string, nomeCartao?: string): string {
  return nomeCartao || LABELS_PADRAO[cartao] || cartao
}

/** Contexto da importação para construir o deep link da notificação. */
export interface ContextoImportacao {
  /** Datas de compra (data_compra, YYYY-MM-DD) das transações inseridas — para filtro de dia. */
  purchaseDates?: string[]
  /** Valores de projeto_fatura (YYYY-MM-DD) das transações inseridas — para navegar ao mês correto. */
  projetoFaturas?: string[]
  /** Timestamp (Date.now()) do início da importação — identifica compras recém-importadas na tela. */
  importTs?: number
}

/**
 * Constrói a URL de deep link para a tela de Compras com filtros contextuais.
 * Rota erros para /importar, sucessos para /compras com cartao + mes + dia (quando único) + ts.
 */
function buildDeepLinkUrl(cartao: string, ctx: ContextoImportacao): string {
  const params = new URLSearchParams()
  params.set('cartao', cartao)
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

  const dates = ctx.purchaseDates ?? []
  if (dates.length > 0) {
    const dias = [...new Set(dates.map(d => d.substring(8, 10)))]
    if (dias.length === 1) {
      params.set('dia', String(parseInt(dias[0], 10)))
    }
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

  if (tipo === 'sucesso') {
    const temNovas = (novas ?? 0) > 0
    const temConflitos = (conflitos ?? 0) > 0

    if (temNovas) {
      const n = novas!
      title = `${nome} — novas compras`
      body = `${n} nova${n !== 1 ? 's compras foram' : ' compra foi'} importada${n !== 1 ? 's' : ''} com sucesso.`
    } else {
      title = `${nome} — importação concluída`
      body = 'Nenhuma compra nova foi encontrada.'
    }

    if (temConflitos) {
      const c = conflitos!
      body += ` ${c} conflito${c !== 1 ? 's' : ''} de valor ${c !== 1 ? 'precisam' : 'precisa'} de revisão.`
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
  // Sucessos com novas compras: deep link para /compras com filtros pré-aplicados.
  const temNovasCompras = (novas ?? 0) > 0
  let url: string
  if (tipo === 'erro' || !temNovasCompras) {
    url = '/importar'
  } else if (contexto && ((contexto.purchaseDates?.length ?? 0) > 0 || (contexto.projetoFaturas?.length ?? 0) > 0)) {
    url = buildDeepLinkUrl(cartao, contexto)
  } else {
    url = `/compras?cartao=${cartao}&ts=${contexto?.importTs ?? Date.now()}`
  }

  const payload = {
    title,
    body,
    url,
    tag,
    requireInteraction: tipo === 'erro',
  }

  try {
    // Usa o cliente autenticado passado pela rota (tem sessão de usuário → passa na RLS).
    // Se não retornar subscriptions (rota sem sessão, ex: API key), tenta o cliente anon
    // como fallback para manter compatibilidade com importações automatizadas.
    let { data: subs } = await supabase.from('push_subscriptions').select('*')
    if (!subs?.length) {
      const { data: subsFallback } = await supabasePush.from('push_subscriptions').select('*')
      subs = subsFallback
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
      // Usa o mesmo cliente que conseguiu ler (autenticado se disponível)
      await supabase.from('push_subscriptions').delete().in('usuario', expiradas)
    }
  } catch { /* falha no push nunca deve interromper a resposta */ }
}
