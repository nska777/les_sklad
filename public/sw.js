const CACHE = "russian-forest-warehouse-v2";
const STATIC_ASSETS = ["/manifest.webmanifest", "/app-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // API и страницы с авторизацией всегда должны идти в сеть.
  // Иначе старый HTML/сессия могут оставаться в PWA-кэше после деплоя.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/login" ||
    url.pathname.startsWith("/login/")
  ) {
    return;
  }

  // Навигационные HTML-страницы не кэшируем вообще.
  // Это предотвращает старые Server Actions и открытие не той страницы по URL.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  // Кэшируем только статические GET-ресурсы. Сначала сеть, при офлайне — кэш.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
