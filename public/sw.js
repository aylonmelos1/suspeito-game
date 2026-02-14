const CACHE_NAME = 'suspeito-v2';
const ASSETS = [
    './',
    './index.html',
    './app.html',
    './style.css',
    './app.js',
    './table.json',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// Install: pre-cacheia os assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    // Ativa imediatamente sem esperar tabs antigas fecharem
    self.skipWaiting();
});

// Activate: limpa caches antigos
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            );
        })
    );
    // Assume controle imediato das páginas
    self.clients.claim();
});

// Fetch: Network-first para HTML/CSS/JS, cache-first para imagens
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Ignora requests que não são GET
    if (e.request.method !== 'GET') return;

    // Ignora APIs e socket.io
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

    // Network-first: tenta rede, fallback para cache
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // Atualiza o cache com a resposta fresca
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, clone);
                });
                return response;
            })
            .catch(() => {
                // Offline: retorna do cache
                return caches.match(e.request);
            })
    );
});
