const CACHE_NAME = 'gestao-financeira-v8'

// Tags auto-fecháveis ao abrir o app — processo concluído, notificação apenas informativa.
// Mantido em sincronia com SW_AUTO_CLOSE_TAGS em lib/notificationTypes.ts.
// Importações de sucesso são gerenciadas por closeImportSuccessNotifications() (prefixo-based).
// NUNCA inclui tags de erro ou ação obrigatória.
const AUTO_CLOSE_TAGS = [
  'categorizacao',
  'wishlist-concluido',
  'lista-mercado',
  'lista-sincronizacao',
  'pedido-concluido',
  'pagamento',
  'ia-processamento',
  'ia-analise',
]

// Tags que persistem até o usuário interagir — exigem ação.
// Notificações de erro de importação por cartão (importacao-erro-*) recebem
// requireInteraction: true direto no payload, não precisam estar nesta lista.
const PERSISTENT_TAGS = [
  'importacao-erro',
  'conta-vencendo',
  'conta-atrasada',
  'pedido-pendente',
  'conciliacao',
  'ia-falha',
]

// Mapa de tags de grupo → outras tags do mesmo grupo que fecham junto ao clicar qualquer uma.
// Importações são gerenciadas por closeImportSuccessNotifications() (prefixo-based).
const GRUPO_TAGS = {
  wishlist:   ['wishlist', 'wishlist-ia', 'wishlist-concluido'],
  mercado:    ['lista-mercado', 'lista-sincronizacao', 'lista-compartilhado'],
  pedidos:    ['pedido', 'pedido-concluido'],
  ia:         ['ia-processamento', 'ia-analise'],
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Fecha notificações de importação bem-sucedida de qualquer cartão.
// Nunca fecha 'importacao-erro-*': falhas exigem ação do usuário.
// Suporta tanto a tag legada 'importacao-sucesso' quanto as tags únicas
// por cartão 'importacao-sucesso-nubank', 'importacao-sucesso-cartao1', etc.
function closeImportSuccessNotifications() {
  return self.registration.getNotifications().then(function (all) {
    all.forEach(function (n) {
      if (n.tag && (n.tag === 'importacao' || n.tag === 'importacao-sucesso' || n.tag.startsWith('importacao-sucesso-'))) {
        n.close()
      }
    })
  })
}

// Fecha notificações por array de tags exatas (usado para notificações regulares).
function closeNotificationsByTags(tags) {
  return Promise.all(
    tags.map(function (tag) {
      return self.registration.getNotifications({ tag: tag }).then(function (list) {
        list.forEach(function (n) { n.close() })
      })
    })
  )
}

function getGrupoTags(clickedTag) {
  for (const grupo of Object.values(GRUPO_TAGS)) {
    if (grupo.includes(clickedTag)) return grupo
  }
  return []
}

// Rotas críticas pré-cacheadas no install para garantir abertura offline.
const PRECACHE_ROUTES = [
  '/',
  '/dashboard',
  '/lista-mercado',
  '/financas',
  '/compras',
  '/contas',
  '/receitas',
  '/investimentos',
  '/assinaturas',
  '/wishlist',
  '/chat',
  '/configuracoes',
]

const NAVIGATION_TIMEOUT_MS = 4000

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    fetch(request).then(res => { clearTimeout(timer); resolve(res) }, err => { clearTimeout(timer); reject(err) })
  })
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        PRECACHE_ROUTES.map(url =>
          fetch(url, { redirect: 'follow' })
            .then(res => {
              if (res.ok && !res.redirected) return cache.put(url, res)
            })
            .catch(() => {})
        )
      )
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
  )
})

// ── Cache de recursos ──────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method === 'POST' && url.pathname === '/api/share-receiver') return
  if (request.method !== 'GET') return
  if (!url.href.startsWith(self.location.origin)) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  if (
    url.pathname.startsWith('/icon') ||
    url.pathname.startsWith('/splash') ||
    url.pathname.startsWith('/apple') ||
    url.pathname.match(/\.(png|jpg|jpeg|webp|svg|ico|woff2|woff)$/)
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request)
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone())
          return response
        }).catch(() => cached)
        return cached ?? fetchPromise
      })
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)
        .then(response => {
          if (response.ok && !response.redirected) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        })
        .catch(() =>
          caches.match(request, { ignoreVary: true }).then(cached => {
            if (cached) return cached
            return caches.match('/lista-mercado', { ignoreVary: true }).then(shell => {
              if (shell) return shell
              return caches.match('/dashboard', { ignoreVary: true }).then(dash => {
                if (dash) return dash
                return caches.open(CACHE_NAME).then(cache =>
                  cache.keys().then(keys => {
                    const nav = keys.find(k => {
                      const u = new URL(k.url)
                      return u.origin === self.location.origin &&
                        !u.pathname.startsWith('/_next/') &&
                        !u.pathname.startsWith('/api/')
                    })
                    return nav ? cache.match(nav, { ignoreVary: true }) : undefined
                  })
                )
              })
            })
          })
        )
    )
    return
  }
})

// ── Push Notifications ─────────────────────────────────────────────────────

self.addEventListener('push', function (event) {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {}

  const title = data.title || 'Gestão Financeira'
  const tag = data.tag || 'gestao-push'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    data: { url: data.url || '/dashboard', tag },
    vibrate: [200, 100, 200],
    // Notificações de erro/ação obrigatória ficam visíveis até o usuário interagir
    requireInteraction: data.requireInteraction === true || PERSISTENT_TAGS.includes(tag),
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options).catch(() => {}),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (clientList) {
          clientList.forEach(function (client) {
            client.postMessage({ type: 'PUSH_RECEIVED' })
          })
        }),
    ])
  )
})

self.addEventListener('message', function (event) {
  const type = event.data?.type

  // Fecha notificações informativas ao abrir/retornar ao app:
  // 1. importações de sucesso por cartão (prefixo-based, PR #142)
  // 2. demais tags auto-fecháveis (categorizacao, wishlist-concluido, etc.)
  // Erros ('importacao-erro-*') não são fechados — exigem ação do usuário.
  if (type === 'APP_OPENED' || type === 'CLOSE_IMPORT_NOTIFICATIONS') {
    event.waitUntil(Promise.all([
      closeImportSuccessNotifications(),
      closeNotificationsByTags(AUTO_CLOSE_TAGS),
    ]))
    return
  }

  // Fecha notificações por array de tags (IDs de DB ou tags de grupo)
  if (type === 'CLOSE_NOTIFICATIONS') {
    const tags = Array.isArray(event.data.tags) ? event.data.tags : []
    if (!tags.length) return
    event.waitUntil(closeNotificationsByTags(tags))
  }
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/dashboard'
  const clickedTag = event.notification.data?.tag || event.notification.tag

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Fecha notificações irmãs ao clicar: importações por prefixo, outros por grupo
      if (clickedTag === 'importacao' || clickedTag === 'importacao-sucesso' || clickedTag.startsWith('importacao-sucesso-')) {
        closeImportSuccessNotifications().catch(() => {})
      } else {
        const grupoTags = getGrupoTags(clickedTag)
        if (grupoTags.length > 0) {
          closeNotificationsByTags(grupoTags).catch(() => {})
        } else if (AUTO_CLOSE_TAGS.includes(clickedTag)) {
          closeNotificationsByTags([clickedTag]).catch(() => {})
        }
      }

      // Foca janela existente e navega, ou abre nova
      for (const client of clientList) {
        if ('focus' in client) {
          return client.navigate(targetUrl).then(function (c) {
            return c ? c.focus() : client.focus()
          })
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})
