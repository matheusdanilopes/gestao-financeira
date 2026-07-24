const CACHE_NAME = 'gestao-financeira-v16'
// Cache separado e permanente para ícones/splash screens (Add to Home Screen do iOS).
// Nunca é apagado em bumps de CACHE_NAME — só esses assets mudam de conteúdo (raro),
// nunca de nome de arquivo. Misturar com CACHE_NAME fazia o activate() apagar os ícones
// a cada deploy, criando uma janela em que uma falha de rede podia fazer o iOS capturar
// um ícone/splash quebrado ao recriar o atalho na tela de início.
const STATIC_CACHE_NAME = 'gestao-financeira-static-v1'

const OFFLINE_HTML = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Carregando…</title><script>setTimeout(function(){location.reload()},4000)<\/script></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><p>Reconectando…</p></body></html>'
const OFFLINE_RESPONSE = () => new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

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
// Não inclui '/' — o servidor redireciona para /dashboard (redirected:true)
// e a resposta não pode ser cacheada nem servida corretamente em iOS/WKWebView.
const PRECACHE_ROUTES = [
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
  '/listas-compras',
]

// Ícones/splash screens usados pelo iOS para o atalho "Adicionar à Tela de Início".
// Pré-cacheados no install para nunca depender de uma busca de rede no momento em
// que o iOS captura o ícone/splash do app.
const PRECACHE_STATIC = [
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/splash-1125x2436.png',
  '/splash-1170x2532.png',
  '/splash-1179x2556.png',
  '/splash-1242x2208.png',
  '/splash-1284x2778.png',
  '/splash-1290x2796.png',
  '/splash-1536x2048.png',
  '/splash-2048x2732.png',
  '/splash-640x1136.png',
  '/splash-750x1334.png',
  '/splash-828x1792.png',
  '/splash-light-1125x2436.png',
  '/splash-light-1170x2532.png',
  '/splash-light-1179x2556.png',
  '/splash-light-1242x2208.png',
  '/splash-light-1284x2778.png',
  '/splash-light-1290x2796.png',
  '/splash-light-1536x2048.png',
  '/splash-light-2048x2732.png',
  '/splash-light-640x1136.png',
  '/splash-light-750x1334.png',
  '/splash-light-828x1792.png',
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
    Promise.all([
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
      ),
      caches.open(STATIC_CACHE_NAME).then(cache =>
        Promise.allSettled(
          PRECACHE_STATIC.map(url =>
            cache.match(url).then(existing => {
              if (existing) return
              return fetch(url).then(res => {
                if (res.ok) return cache.put(url, res)
              }).catch(() => {})
            })
          )
        )
      ),
    ])
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE_NAME).map(k => caches.delete(k))
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
        }).catch(() => new Response('', { status: 503, statusText: 'Service Unavailable' }))
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
      caches.open(STATIC_CACHE_NAME).then(async cache => {
        const cached = await cache.match(request)
        if (cached) {
          // Serve from cache immediately; update in background
          fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone())
          }).catch(() => {})
          return cached
        }
        // Not cached: fetch from network (may throw, letting browser handle error natively)
        return fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone())
          return response
        }).catch(() => new Response('', { status: 503, statusText: 'Service Unavailable' }))
      })
    )
    return
  }

  if (request.mode === 'navigate') {
    // Root path redirects to /dashboard on the server. Intercepting it and returning
    // response.redirected=true to WKWebView (iOS Safari / Chrome iOS) causes
    // "This page couldn't load". Skip the SW and let the browser handle the redirect
    // natively; the /dashboard navigation will be intercepted separately.
    if (url.pathname === '/') return

    event.respondWith(
      // redirect:'manual' means if the server returns a redirect, we get an opaque redirect
      // response (type:'opaqueredirect') which we pass back to the browser to follow itself —
      // this is iOS-safe. Contrast with redirect:'follow' which produces response.redirected=true
      // that WKWebView can reject for navigation events.
      fetchWithTimeout(new Request(request, { redirect: 'manual' }), NAVIGATION_TIMEOUT_MS)
        .then(response => {
          // Opaque redirect — pass through for browser to follow (no caching)
          if (response.type === 'opaqueredirect') return response
          // Normal response — cache and serve
          if (response.ok) {
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
                    // Guard: cache.match(nav) can resolve to undefined on iOS if the entry was
                    // evicted between cache.keys() and cache.match(). Always fall back to OFFLINE_RESPONSE.
                    if (nav) return cache.match(nav, { ignoreVary: true }).then(r => r || OFFLINE_RESPONSE())
                    return OFFLINE_RESPONSE()
                  })
                )
              })
            })
          })
          // Last-resort guard: if any step in the cache chain itself throws, still return a valid Response.
          .catch(() => OFFLINE_RESPONSE())
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
  // "Quão informativo" é este push (ver lib/pushImportacao.ts). Ausente em tipos de
  // notificação que não usam esse conceito — tratado como 0, o que nunca bloqueia nada
  // (0 > 0 é falso), preservando o comportamento antigo para eles.
  const score = typeof data.score === 'number' ? data.score : 0
  const isPersistent = data.requireInteraction === true ||
    PERSISTENT_TAGS.some(function (t) { return tag === t || tag.startsWith(t + '-') })
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge.png',
    tag,
    renotify: true,
    data: { url: data.url || '/dashboard', tag, score },
    vibrate: [200, 100, 200],
    silent: false,
    // Notificações de erro/ação obrigatória ficam visíveis até o usuário interagir
    requireInteraction: isPersistent,
  }

  event.waitUntil(
    Promise.all([
      self.registration.getNotifications({ tag: tag }).then(function (existing) {
        // Não deixa um resultado menos informativo (ex.: "nenhuma compra nova" de uma
        // reimportação/retry para o mesmo cartão) sobrescrever no tray uma notificação
        // anterior mais relevante (ex.: "5 novas compras") que o usuário ainda não viu.
        const substituiPiorResultado = existing.some(function (n) {
          const scoreAnterior = typeof (n.data && n.data.score) === 'number' ? n.data.score : 0
          return scoreAnterior > score
        })
        if (substituiPiorResultado) return
        return self.registration.showNotification(title, options)
      }).catch(() => {}),
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

      // Foca janela existente (mesmo origin) e navega, ou abre nova
      const existingClient = clientList.find(function (c) {
        try { return new URL(c.url).origin === self.location.origin } catch (_) { return false }
      })
      if (existingClient) {
        return existingClient.navigate(targetUrl)
          .then(function (c) { return (c || existingClient).focus() })
          .catch(function () {
            if (clients.openWindow) return clients.openWindow(targetUrl)
            return existingClient.focus()
          })
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})
