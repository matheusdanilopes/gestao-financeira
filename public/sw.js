const CACHE_NAME = 'gestao-financeira-v3'

// Rotas críticas pré-cacheadas no install para garantir abertura offline
// independente do histórico de navegação do usuário.
const PRECACHE_ROUTES = ['/', '/dashboard', '/lista-mercado']

// ── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // Pré-cacheia rotas críticas enquanto o servidor ainda está acessível
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        PRECACHE_ROUTES.map(url =>
          fetch(url, { redirect: 'follow' })
            .then(res => { if (res.ok) return cache.put(url, res) })
            .catch(() => { /* sem rede durante install — será cacheado na 1ª visita */ })
        )
      )
    )
  )
})

self.addEventListener('activate', (event) => {
  // Remove caches de versões anteriores e assume controle imediatamente
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

  // Só intercepta GET da mesma origem
  if (request.method !== 'GET') return
  if (!url.href.startsWith(self.location.origin)) return

  // API calls: não intercepta — useDataSync já trata offline via cache localStorage
  if (url.pathname.startsWith('/api/')) return

  // Assets estáticos do Next.js (chunks JS/CSS com hash — imutáveis):
  // cache-first → serve do cache instantaneamente quando disponível
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()))
          }
          return response
        })
      })
    )
    return
  }

  // Navegações de página (HTML): network-first com fallback para cache.
  // Quando offline, serve a versão em cache da página ou qualquer página
  // em cache como shell — o React lê a URL atual e renderiza a rota correta.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()))
          }
          return response
        })
        .catch(() =>
          caches.match(request).then(cached => {
            if (cached) return cached
            // Fallback para /lista-mercado (rota com suporte offline completo)
            return caches.match('/lista-mercado').then(shell => {
              if (shell) return shell
              // Fallback para /dashboard ou qualquer página em cache
              return caches.match('/dashboard').then(dash => {
                if (dash) return dash
                return caches.open(CACHE_NAME).then(cache =>
                  cache.keys().then(keys => {
                    const nav = keys.find(k => {
                      const u = new URL(k.url)
                      return u.origin === self.location.origin &&
                        !u.pathname.startsWith('/_next/') &&
                        !u.pathname.startsWith('/api/')
                    })
                    return nav ? cache.match(nav) : undefined
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
    data: { url: data.url || '/dashboard' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  }

  event.waitUntil(
    Promise.all([
      // Exibe a notificação do sistema — funciona mesmo com o app fechado
      self.registration.showNotification(title, options).catch(() => {}),
      // Avisa clientes abertos para recarregar notificações sem depender só do Realtime
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (clientList) {
          clientList.forEach(function (client) {
            client.postMessage({ type: 'PUSH_RECEIVED' })
          })
        }),
    ])
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
