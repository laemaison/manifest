// Offline support. index.html is fully self-contained (React and the compiled
// app are inlined), so the precache is small and the app runs with no network.
// Google Fonts are cached opportunistically on first online load; without them
// the app falls back to system fonts and stays usable.

const VERSION = "manifest-v2";
const CORE = VERSION + "-core";
const RUNTIME = VERSION + "-runtime";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CORE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CORE && k !== RUNTIME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations: serve the cached shell so a cold start works offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CORE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() =>
          caches
            .match("./index.html", { ignoreSearch: true })
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // Same-origin assets: cache first, they are versioned by the build.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CORE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Fonts and anything else cross-origin: stale-while-revalidate.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});
