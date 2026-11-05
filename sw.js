const VERSION = "casanova-eabd60a878b5b370";
const PRECACHE = [
  "./",
  "index.html",
  "instalar.html",
  "style.css",
  "app.js",
  "assistant.js",
  "cliente.js",
  "mobile-api.js",
  "imagen.js",
  "editor.js",
  "panels.js",
  "viewer.js",
  "manifest.webmanifest",
  "vendor/three.module.js",
  "vendor/OrbitControls.js",
  "iconos/icono-192.png",
  "iconos/icono-512.png",
  "iconos/apple-touch-icon.png",
];

const PORTATIL = new URL(self.location.href).searchParams.get("portable") === "1";

if (PORTATIL) {
  try {
    importScripts("sw-extra.js");
  } catch {}
}

const EXTRA = PORTATIL && Array.isArray(self.PRECACHE_EXTRA) ? self.PRECACHE_EXTRA : [];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all([...PRECACHE, ...EXTRA].map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  evento.respondWith(
    fetch(pedido)
      .then((respuesta) => {
        if (respuesta.ok && respuesta.type === "basic") {
          const copia = respuesta.clone();
          caches.open(VERSION).then((cache) => cache.put(pedido, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(pedido).then((r) => r || (pedido.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});
