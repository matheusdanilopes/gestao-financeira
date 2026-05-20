const CACHE_NAME = 'gestao-financeira-v6'

// Rotas críticas pré-cacheadas no install para garantir abertura offline
const PRECACHE_ROUTES = ['/', '/dashboard', '/lista-mercado', '/financas', '/compras']

// Timeout para requisições de navegação — evita tela branca em conexões lentas
const NAVIGATION_TIMEOUT_MS = 4000

// ── Helpers ────────────────────────────────────────────────────────────────

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
              // Não cacheia redirect (ex: /login quando não autenticado).
              // response.redirected é true quando o fetch seguiu um redirect.
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

  // Share Target: deixa o browser enviar diretamente ao servidor via rede
  if (request.method === 'POST' && url.pathname === '/api/share-receiver') return

  // Só intercepta GET da mesma origem
  if (request.method !== 'GET') return
  if (!url.href.startsWith(self.location.origin)) return

  // API calls: não intercepta — useDataSync trata offline via localStorage
  if (url.pathname.startsWith('/api/')) return

  // Assets estáticos do Next.js (chunks JS/CSS com hash — imutáveis):
  // cache-first → serve do cache instantaneamente; network só na 1ª visita.
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

  // Assets públicos imutáveis (imagens, ícones, splash screens):
  // cache-first com revalidação em background (stale-while-revalidate)
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

  // Navegações de página (HTML): network-first com timeout e fallback para cache.
  // Timeout de 4s evita tela branca em conexões 3G lentas.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)
        .then(response => {
          // Não cacheia redirect: evita guardar a página de login para rotas protegidas.
          // response.redirected é true quando o fetch seguiu um redirect HTTP.
          if (response.ok && !response.redirected) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        })
        .catch(() =>
          // ignoreVary evita que Vary headers do Next.js (RSC, Next-Router-State-Tree)
          // impeçam o match de respostas cacheadas em navegações subsequentes.
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
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'gestao-push',
    data: { url: data.url || '/dashboard' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
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
  if (event.data?.type !== 'CLOSE_NOTIFICATIONS') return
  const tags = Array.isArray(event.data.tags) ? event.data.tags : []
  if (!tags.length) return
  event.waitUntil(
    Promise.all(tags.map(function (tag) {
      return self.registration.getNotifications({ tag: tag }).then(function (list) {
        list.forEach(function (n) { n.close() })
      })
    }))
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/dashboard'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
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
