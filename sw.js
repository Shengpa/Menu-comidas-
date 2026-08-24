const CACHE_NAME = "menu-domingo-v2";
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

// Network-first de verdad para el shell: intenta traer la versión nueva de la red,
// y solo si falla (sin conexión) usa la copia guardada. Así los cambios de código/estilos
// se ven apenas se suben, sin depender de que el usuario limpie la caché a mano.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShell = SHELL.some((p) => url.pathname.endsWith(p.replace("./", "")));
  if (!isShell) return; // dejar pasar llamadas a Firestore / Anthropic sin interceptar

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
