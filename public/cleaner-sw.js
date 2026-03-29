const SW_VERSION = "cleaner-v1";
const STATIC_CACHE = `${SW_VERSION}-static`;
const DATA_CACHE = `${SW_VERSION}-data`;

const APP_SHELL_ROUTES = [
  "/cleaner",
  "/cleaner/history",
  "/cleaner/incidents/new",
  "/cleaner/settings",
  "/cleaner-manifest.webmanifest",
  "/icons/cleaner-icon-192.png",
  "/icons/cleaner-icon-512.png",
  "/icons/cleaner-icon-maskable-512.png"
];

const QUERY_FUNCTIONS_TO_CACHE = [
  "cleaningJobs:queries:getMyAssigned",
  "cleaningJobs:queries:getMyJobDetail",
  "cleaningJobs.queries.getMyAssigned",
  "cleaningJobs.queries.getMyJobDetail"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ROUTES))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(SW_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldCacheStatic(url) {
  if (url.origin !== self.location.origin) {
    return false;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    return true;
  }

  if (url.pathname.startsWith("/icons/")) {
    return true;
  }

  return /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstCleanerPage(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedPage = await cache.match(request);
    if (cachedPage) {
      return cachedPage;
    }
    return (
      (await cache.match("/cleaner")) ||
      new Response("Offline and no cached cleaner screen available.", {
        status: 503,
        headers: { "Content-Type": "text/plain" }
      })
    );
  }
}

function getFunctionPathFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidates = [payload.path, payload.udfPath, payload.function, payload.name];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function shouldCacheQueryPath(path) {
  return QUERY_FUNCTIONS_TO_CACHE.some((candidate) => path.includes(candidate));
}

function buildQueryCacheKey(path, args) {
  const encodedPath = encodeURIComponent(path);
  const encodedArgs = encodeURIComponent(JSON.stringify(args ?? {}));
  return new Request(`https://cleaner.local/query-cache?path=${encodedPath}&args=${encodedArgs}`);
}

async function networkWithQueryCache(request) {
  let payload;

  try {
    payload = await request.clone().json();
  } catch {
    return fetch(request);
  }

  const path = getFunctionPathFromPayload(payload);
  if (!path || !shouldCacheQueryPath(path)) {
    return fetch(request);
  }

  const cacheKey = buildQueryCacheKey(path, payload.args ?? payload.arguments ?? null);
  const cache = await caches.open(DATA_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(cacheKey, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
    return new Response(
      JSON.stringify({
        error: "Offline and no cached cleaner query payload available.",
        path
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === self.location.origin && url.pathname.startsWith("/cleaner")) {
    event.respondWith(networkFirstCleanerPage(request));
    return;
  }

  if (request.method === "GET" && shouldCacheStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.method === "POST" && url.pathname.includes("/api/query")) {
    event.respondWith(networkWithQueryCache(request));
  }
});
