const CACHE_NAME = 'juaba-delivery-pwa-v3';
const INITIAL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json'
];

// Instala o Service Worker imediatamente e salva os arquivos básicos
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(INITIAL_ASSETS).catch(() => {});
        })
    );
});

// Assume o controle de todas as abas abertas imediatamente
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Interceptador fetch (Obrigatório para o Chrome no Android instalar sem barra de URL)
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Ignora requisições que não sejam GET ou que sejam de APIs externas (Firebase/Google)
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (
        url.origin !== self.location.origin ||
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('script.google.com')
    ) {
        return;
    }

    // Estratégia Network-First (busca sempre a versão mais nova online e usa cache se estiver sem internet)
    event.respondWith(
        fetch(req)
            .then((networkRes) => {
                if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
                    const resClone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
                }
                return networkRes;
            })
            .catch(() => {
                return caches.match(req).then((cachedRes) => {
                    if (cachedRes) return cachedRes;
                    if (req.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});

// Recebe notificações Push mesmo quando o aplicativo está fechado
self.addEventListener('push', (event) => {
    let payload = {
        title: '🛵 JuabaDelivery',
        body: 'Há uma nova atualização no seu pedido!',
        orderId: ''
    };

    if (event.data) {
        try {
            const parsed = event.data.json();
            payload.title = parsed?.notification?.title || parsed?.data?.title || parsed.title || payload.title;
            payload.body = parsed?.notification?.body || parsed?.data?.body || parsed.body || payload.body;
            payload.orderId = parsed?.data?.orderId || parsed.orderId || '';
        } catch (e) {
            payload.body = event.data.text() || payload.body;
        }
    }

    const options = {
        body: payload.body,
        icon: 'https://placehold.co/192x192/ea1d2c/ffffff.png?text=JD',
        badge: 'https://placehold.co/192x192/ea1d2c/ffffff.png?text=JD',
        tag: payload.orderId ? 'juaba_ord_' + payload.orderId : 'juaba_push_' + Date.now(),
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 120, 300, 120, 400],
        data: {
            orderId: payload.orderId,
            url: self.location.origin + '/?pedido=' + (payload.orderId || '')
        }
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

// Quando o cliente toca na notificação na barra do celular, abre o app direto no pedido
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || (self.location.origin + '/');

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
