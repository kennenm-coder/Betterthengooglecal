// v10: wipes the page contents earlier versions saved (see the RSC note below).
const CACHE_NAME = "rba-field-cal-v10";
const PRECACHE_URLS = ["/", "/search", "/admin", "/time-off", "/login", "/settings"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Never cache cross-origin requests (Supabase, etc.)
  if (url.origin !== self.location.origin) return;

  // Never cache API calls — data must always come fresh from Supabase.
  // Caching these caused stale appointment times and missing data on mobile.
  if (url.pathname.startsWith("/api/")) return;

  // Never cache a screen's contents fetched while switching tabs (Next.js
  // "RSC" requests, e.g. "/?_rsc=..."). These aren't full page loads, so they
  // used to fall through to the cache-first rule below and stick forever. After
  // a deploy, Search -> Calendar could be handed the OLD Calendar, which points
  // at code files the new deploy no longer has, and the app crashed with
  // "Application error... reload".
  if (
    url.searchParams.has("_rsc") ||
    event.request.headers.get("RSC") === "1" ||
    event.request.headers.has("Next-Router-Prefetch")
  ) {
    return;
  }

  // Navigation requests (HTML pages): network-first so auth and code changes always apply
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets (JS, CSS, images): cache-first for speed, update in background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
