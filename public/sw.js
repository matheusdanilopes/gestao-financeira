const CACHE_NAME = 'gestao-financeira-v2'

// ── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting()
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
            // Fallback para qualquer página em cache — React re-roteará via URL
            return caches.match('/dashboard').then(shell => {
              if (shell) return shell
              // Último recurso: varredura em qualquer entrada de navegação
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
        )
    )
    return
  }
})

// ── Push Notifications ─────────────────────────────────────────────────────

self.addEventListener('push', function (event) {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Gestão Financeira'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/dashboard' },
    vibrate: [200, 100, 200],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          client.navigate(event.notification.data.url || '/dashboard')
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/dashboard')
      }
    })
  )
})
