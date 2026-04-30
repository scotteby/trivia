const CACHE_NAME = 'quizzli-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/host.html',
  '/join.html',
  '/practice.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache for HTML pages
// Always use network for API calls
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls or Supabase/Anthropic requests
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('supabase') ||
      url.hostname.includes('anthropic') ||
      url.hostname.includes('itunes')) {
    return;
  }

  // Network first for everything else
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
