// Cache semplice per usare l'app anche offline
const CACHE = "pitstop-v27";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "respiro.html", "battito.js",
  "fonts/fonts.css", "fonts/caladea-400.woff2", "fonts/caladea-700.woff2", "fonts/lato-400.woff2", "fonts/lato-700.woff2", "fonts/ibm-plex-mono-400.woff2"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
// Cancello solo le mie cache vecchie: sullo stesso indirizzo github.io vivono altre app
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("pitstop-") && k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // i video si scaricano a pezzi: li lascio al browser, senza cache
  if (url.pathname.includes("/video/")) return;
  e.respondWith(fetch(e.request).then(r => {
      // salvo solo risposte buone, mai pagine di errore
      if (r.ok && url.origin === self.location.origin) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    })
    // offline: respiro.html?... deve trovare respiro.html anche con i parametri
    .catch(() => caches.match(e.request, {ignoreSearch: true})));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({type:"window"}).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./"))); });
