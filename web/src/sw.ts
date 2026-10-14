// Offline app shell. Hashed /assets/* never change: served from the cache. Pages go to the network first (so a
// deploy shows up on the next load) and fall back to the cached shell offline; every route is the same SPA shell.
// ASSETS and VERSION are injected by build.ts.
export {}; // a module, so `self` below can be the service worker scope
declare const self: ServiceWorkerGlobalScope;
declare const ASSETS: string[];
declare const VERSION: string;

const CACHE = `rl-${VERSION}`;
// A missing asset gets the SPA fallback (index.html, status 200). Caching that under a hashed asset name would
// break the app until the next deploy, so only real assets count.
const isAsset = (res: Response) => res.ok && !res.headers.get("content-type")?.includes("text/html");

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.add("/");
      for (const a of ASSETS) {
        const res = await fetch(a, { cache: "reload" });
        if (!isAsset(res)) throw new Error(`asset not deployed yet: ${a}`); // install again on the next visit
        await c.put(a, res);
      }
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((hit) => (hit && isAsset(hit) ? hit : fetch(e.request))));
  } else if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) void caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
  }
});
