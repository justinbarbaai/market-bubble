// Market Bubble service worker — deliberately minimal. A SW with a fetch handler
// is required for the install prompt, but for a LIVE site stale caching is the
// enemy. So: network-first for everything, and we only keep a cached copy of the
// home shell as an OFFLINE fallback. We never cache assets/API responses, so the
// app is never stale.
const CACHE = "mb-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // drop any old caches
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Only intervene on page navigations — give an offline fallback. Everything
  // else (JS, CSS, images, API, the live WS) passes straight through to network.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          caches.open(CACHE).then((c) => c.put("/", fresh.clone())).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match("/")) || Response.error();
        }
      })()
    );
  }
});
