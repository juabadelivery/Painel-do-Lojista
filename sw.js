// sw.js - Service Worker JuabaDelivery (Funciona com App Cliente e Painel Lojista fechados)
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

let watchConfig = {
    projectId: 'juaba-delivery',
    emailCliente: '',
    lojaId: ''
};
const clientStatusMemory = {};
const clientChatMemory = {};
const storeOrdersMemory = new Set();
const storeChatMemory = {};
let initializedClient = false;
let initializedStore = false;

// Recebe credenciais de monitoramento do App Cliente e do Painel Lojista
self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'JUABA_WATCH_CLIENT') {
        if (data.projectId) watchConfig.projectId = data.projectId;
        if (data.emailCliente && data.emailCliente !== watchConfig.emailCliente) {
            watchConfig.emailCliente = data.emailCliente;
            initializedClient = false;
        }
        checkFirestoreInBackground();
    } else if (data.type === 'JUABA_WATCH_STORE') {
        if (data.projectId) watchConfig.projectId = data.projectId;
        if (data.lojaId && data.lojaId !== watchConfig.lojaId) {
            watchConfig.lojaId = data.lojaId;
            initializedStore = false;
        }
        checkFirestoreInBackground();
    }
});

async function checkFirestoreInBackground() {
    const proj = watchConfig.projectId || 'juaba-delivery';
    const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;

    // 1. Monitora atualizações de status e chat para o Cliente mesmo com o app fechado
    if (watchConfig.emailCliente) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'pedidos' }],
                        where: {
                            fieldFilter: {
                                field: { fieldPath: 'emailCliente' },
                                op: 'EQUAL',
                                value: { stringValue: watchConfig.emailCliente }
                            }
                        }
                    }
                })
            });
            const rows = await res.json();
            if (Array.isArray(rows)) {
                for (const r of rows) {
                    if (!r.document) continue;
                    const docId = r.document.name.split('/').pop();
                    const f = r.document.fields || {};
                    const status = f.status?.stringValue || 'Novo';
                    const nomeLoja = f.nomeLoja?.stringValue || 'Restaurante';
                    const chatValues = f.chat?.arrayValue?.values || [];
                    const storeMsgs = chatValues.filter(v => v.mapValue?.fields?.sender?.stringValue === 'loja');
                    const storeMsgCount = storeMsgs.length;

                    if (initializedClient) {
                        if (clientStatusMemory[docId] && clientStatusMemory[docId] !== status) {
                            let body = `Status atualizado para: ${status}`;
                            if (status === 'Preparando') body = '🍳 A loja aceitou seu pedido e já está preparando!';
                            else if (status === 'Entrega') body = '🛵 Seu pedido saiu para entrega! Prepare-se para receber.';
                            else if (status === 'Concluido') body = '✅ Pedido entregue e concluído! Bom apetite!';
                            else if (status === 'Cancelado') body = '❌ Seu pedido foi cancelado pela loja.';
                            await showNativeSwNotification(`🛵 ${nomeLoja}`, body, docId);
                        }
                        if (clientChatMemory[docId] !== undefined && storeMsgCount > clientChatMemory[docId]) {
                            const lastMsg = storeMsgs[storeMsgs.length - 1]?.mapValue?.fields?.text?.stringValue || 'Nova mensagem da loja!';
                            await showNativeSwNotification(`💬 ${nomeLoja}`, lastMsg, docId);
                        }
                    }
                    clientStatusMemory[docId] = status;
                    clientChatMemory[docId] = storeMsgCount;
                }
                initializedClient = true;
            }
        } catch (e) {}
    }

    // 2. Monitora novos pedidos e mensagens para o Painel do Lojista mesmo com o app fechado
    if (watchConfig.lojaId) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'pedidos' }],
                        where: {
                            fieldFilter: {
                                field: { fieldPath: 'lojaId' },
                                op: 'EQUAL',
                                value: { stringValue: watchConfig.lojaId }
                            }
                        }
                    }
                })
            });
            const rows = await res.json();
            if (Array.isArray(rows)) {
                for (const r of rows) {
                    if (!r.document) continue;
                    const docId = r.document.name.split('/').pop();
                    const f = r.document.fields || {};
                    const status = f.status?.stringValue || 'Novo';
                    const cliente = f.cliente?.stringValue || 'Cliente';
                    const chatValues = f.chat?.arrayValue?.values || [];
                    const cliMsgs = chatValues.filter(v => v.mapValue?.fields?.sender?.stringValue === 'cliente');
                    const cliMsgCount = cliMsgs.length;

                    if (initializedStore) {
                        if (!storeOrdersMemory.has(docId) && status === 'Novo') {
                            await showNativeSwNotification(
                                `🔔 Novo Pedido #${docId.substring(0, 6).toUpperCase()}`,
                                '🔔 Novo pedido no JuabaDelivery! Abra seu painel para aceitar.',
                                docId
                            );
                        }
                        if (storeChatMemory[docId] !== undefined && cliMsgCount > storeChatMemory[docId]) {
                            const lastMsg = cliMsgs[cliMsgs.length - 1]?.mapValue?.fields?.text?.stringValue || 'Nova mensagem do cliente!';
                            await showNativeSwNotification(`💬 ${cliente}`, lastMsg, docId);
                        }
                    }
                    storeOrdersMemory.add(docId);
                    storeChatMemory[docId] = cliMsgCount;
                }
                initializedStore = true;
            }
        } catch (e) {}
    }
}

setInterval(checkFirestoreInBackground, 15000);

self.addEventListener('periodicsync', (event) => {
    event.waitUntil(checkFirestoreInBackground());
});

self.addEventListener('sync', (event) => {
    event.waitUntil(checkFirestoreInBackground());
});

async function showNativeSwNotification(title, body, orderId) {
    const options = {
        body: String(body || ''),
        icon: 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png',
        tag: orderId ? `juaba_sw_${orderId}_${Date.now()}` : `juaba_sw_${Date.now()}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 400],
        data: { orderId, url: self.registration.scope }
    };
    return self.registration.showNotification(title, options);
}

// Recebe Push direto do FCM / Google Apps Script quando o app está 100% fechado
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { notification: { title: '🛵 JuabaDelivery', body: event.data ? event.data.text() : 'Nova atualização!' } };
    }
    const notif = data.notification || data.data || {};
    const title = notif.title || '🛵 JuabaDelivery';
    const body = notif.body || 'Você tem uma nova atualização no seu pedido!';
    const orderId = data.data?.orderId || notif.orderId || null;

    event.waitUntil(showNativeSwNotification(title, body, orderId));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || self.registration.scope || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
