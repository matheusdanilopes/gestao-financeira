const PLUGGY_BASE_URL = 'https://api.pluggy.ai'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface CachedApiKey {
  apiKey: string
  expiresAt: number
}

// Cache em memória do módulo. Válido apenas dentro de uma mesma instância
// serverless "quente" — em cold start uma nova apiKey é obtida, o que é
// barato e não sensível a rate limit segundo a documentação da Pluggy.
let cachedKey: CachedApiKey | null = null

async function pluggyFetch(path: string, init: RequestInit = {}, apiKey?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (apiKey) headers['X-API-KEY'] = apiKey

  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${PLUGGY_BASE_URL}${path}`, { ...init, headers })
    if (res.status !== 429 || attempt === maxRetries) return res

    const retryAfter = res.headers.get('Retry-After')
    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 2 ** attempt * 1000
    console.warn(`[pluggy] 429 recebido em ${path}, aguardando ${waitMs}ms antes de retry ${attempt + 1}/${maxRetries}`)
    await sleep(waitMs)
  }
  throw new Error(`Falha inesperada ao chamar ${path}`)
}

/** Obtém (e cacheia) a apiKey da Pluggy, válida por ~2h. */
export async function getPluggyApiKey(): Promise<string> {
  if (cachedKey && cachedKey.expiresAt > Date.now() + 5 * 60_000) {
    return cachedKey.apiKey
  }

  const clientId = process.env.PLUGGY_CLIENT_ID
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configurados no servidor.')
  }

  const res = await pluggyFetch('/auth', {
    method: 'POST',
    body: JSON.stringify({ clientId, clientSecret }),
  })
  if (!res.ok) {
    throw new Error(`Falha ao autenticar na Pluggy: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  cachedKey = { apiKey: data.apiKey, expiresAt: Date.now() + 2 * 60 * 60_000 }
  return cachedKey.apiKey
}

/**
 * Cria um connect token de curta duração para o widget Pluggy Connect no
 * browser. Passar `itemId` ativa o modo de atualização/reconexão do widget
 * (necessário para resolver LOGIN_ERROR / MFA em um item já existente).
 */
export async function createConnectToken(itemId?: string): Promise<string> {
  const apiKey = await getPluggyApiKey()
  const res = await pluggyFetch(
    '/connect_token',
    { method: 'POST', body: JSON.stringify(itemId ? { itemId } : {}) },
    apiKey
  )
  if (!res.ok) {
    throw new Error(`Falha ao criar connect token: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.accessToken
}

export interface PluggyItem {
  id: string
  connector: { id: number; name: string }
  status: string
  executionStatus: string
  lastUpdatedAt?: string
  error?: { code: string; message: string } | null
  [key: string]: unknown
}

/** Busca o estado atual do item — fonte de verdade, nunca confiar apenas no payload do webhook. */
export async function getItem(pluggyItemId: string): Promise<PluggyItem> {
  const apiKey = await getPluggyApiKey()
  const res = await pluggyFetch(`/items/${pluggyItemId}`, { method: 'GET' }, apiKey)
  if (!res.ok) {
    throw new Error(`Falha ao buscar item ${pluggyItemId}: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export interface PluggyAccount {
  id: string
  itemId: string
  type: string
  subtype?: string
  name: string
  [key: string]: unknown
}

/** Lista as contas do item — um item pode ter conta corrente + cartão de crédito. */
export async function getAccounts(pluggyItemId: string): Promise<PluggyAccount[]> {
  const apiKey = await getPluggyApiKey()
  const res = await pluggyFetch(`/accounts?itemId=${encodeURIComponent(pluggyItemId)}`, { method: 'GET' }, apiKey)
  if (!res.ok) {
    throw new Error(`Falha ao buscar contas do item ${pluggyItemId}: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.results ?? []
}

export interface PluggyTransaction {
  id: string
  description: string
  amount: number
  date: string
  [key: string]: unknown
}

export interface PluggyTransactionsPage {
  results: PluggyTransaction[]
  total: number
  totalPages: number
  page: number
}

/** Busca uma página de transações de uma conta. Chame em loop até `page >= totalPages`. */
export async function getTransactions(
  accountId: string,
  opts: { from?: string; to?: string; page?: number; pageSize?: number } = {}
): Promise<PluggyTransactionsPage> {
  const apiKey = await getPluggyApiKey()
  const params = new URLSearchParams({ accountId })
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  if (opts.page) params.set('page', String(opts.page))
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize))

  const res = await pluggyFetch(`/transactions?${params.toString()}`, { method: 'GET' }, apiKey)
  if (!res.ok) {
    throw new Error(`Falha ao buscar transações da conta ${accountId}: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/** Busca todas as páginas de transações de uma conta desde `from`. */
export async function getAllTransactions(accountId: string, from: string, to: string): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = []
  let page = 1
  for (;;) {
    const pageData = await getTransactions(accountId, { from, to, page, pageSize: 500 })
    all.push(...pageData.results)
    if (page >= pageData.totalPages || pageData.results.length === 0) break
    page++
  }
  return all
}
