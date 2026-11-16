const CACHE_NAME = "menu-domingo-v3";
const RUNTIME_CACHE = "menu-domingo-runtime-v1";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./firebase-config.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];
const NETWORK_TIMEOUT_MS = 2500;
const MAX_RUNTIME_ENTRIES = 60; // ~ las últimas semanas de fotos + el SDK

function trimCache(cache, max) {
  return cache.keys().then((keys) => {
    if (keys.length <= max) return;
    // Nunca borrar el SDK de Firebase; recortar las imágenes más viejas.
    const imgs = keys.filter((k) => !k.url.includes("/firebasejs/"));
    return Promise.all(imgs.slice(0, keys.length - max).map((k) => cache.delete(k)));
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Archivos que no cambian nunca para una misma URL: el SDK de Firebase (la URL lleva la
// versión) y las fotos/ilustraciones de los platos. Se sirven de la caché sin ir a la red.
function isImmutable(url) {
  return (
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) ||
    url.hostname === "image.pollinations.ai" ||
    url.hostname === "images.pexels.com"
  );
}

function cacheFirst(request) {
  return caches.open(RUNTIME_CACHE).then((cache) =>
    cache.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Las imágenes vienen "opacas" (status 0); igual se pueden guardar.
        if (response.ok || response.type === "opaque") {
          cache.put(request, response.clone()).then(() => trimCache(cache, MAX_RUNTIME_ENTRIES));
        }
        return response;
      });
    })
  );
}

// Shell: sigue siendo network-first (los cambios que subas se ven enseguida), pero si la red
// tarda más de 2,5 s se usa la copia guardada y la nueva queda lista para la próxima vez.
function networkFirstWithTimeout(request) {
  return caches.open(CACHE_NAME).then((cache) => {
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
    const timeout = new Promise((resolve) => {
      setTimeout(() => cache.match(request).then((hit) => hit && resolve(hit)), NETWORK_TIMEOUT_MS);
    });
    return Promise.race([network, timeout]).catch(() => cache.match(request));
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  const isShell = url.origin === self.location.origin &&
    SHELL.some((p) => url.pathname.endsWith(p.replace("./", "")));
  if (!isShell) return; // Firestore / Gemini / Anthropic pasan directo

  event.respondWith(networkFirstWithTimeout(event.request));
});
