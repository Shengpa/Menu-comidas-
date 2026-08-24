const CACHE_NAME = "menu-domingo-v1";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./firebase-config.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first para todo lo que no sea el shell (Firestore y la API van directo a la red).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShell = SHELL.some((p) => url.pathname.endsWith(p.replace("./", "")));
  if (!isShell) return; // dejar pasar llamadas a Firestore / Anthropic sin interceptar
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
