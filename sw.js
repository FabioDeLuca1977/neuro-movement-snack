// Cache semplice per usare l'app anche offline
const CACHE = "pitstop-v12";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "respiro.html"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // i video si scaricano a pezzi: li lascio al browser, senza cache
  if (new URL(e.request.url).pathname.includes("/video/")) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({type:"window"}).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./"))); });
