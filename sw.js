'use strict';
/* sw.js — minimal app-shell service worker: network-first with cache fallback, so a
   dead marina connection still gets the last shell. Forecast responses are cached by
   the app layer in localStorage (data.js), not here — this only covers same-origin
   static files. Cache name is versioned by APP_VERSION so a deploy replaces it. */
importScripts('js/config.js');
const SHELL_CACHE='inletcast-shell-v'+APP_VERSION;
const SHELL=[
  '.', 'index.html', 'css/styles.css', 'manifest.json', 'og.png',
  'js/config.js', 'js/utils.js', 'js/data.js', 'js/scoring.js',
  'js/charts.js', 'js/map.js', 'js/views.js', 'js/app.js',
];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(SHELL_CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==SHELL_CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin||e.request.method!=='GET') return; // APIs: app-layer cache
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r.ok){ const copy=r.clone(); caches.open(SHELL_CACHE).then(c=>c.put(e.request,copy)); }
      return r;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html')))
  );
});
