const CACHE_NAME = "paygent-v1";

self.addEventListener("install", (event) => {
  // Clear old caches and activate immediately
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Network-first strategy: always try network, fall back to cache for offline
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Skip API calls and external URLs
  if (event.request.url.includes("/api/") || !event.request.url.startsWith(self.location.origin)) return;

  // Don't cache tokenized approval URLs (the token is a bearer secret).
  try {
    const url = new URL(event.request.url);
    if (url.searchParams.has("token")) return;
  } catch {
    // If URL parsing fails, fall back to existing behavior.
  }
  
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

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || "Payment Request";
  const body = payload.body || "You have a payment to approve";
  const approvalUrl = payload?.data?.approvalUrl || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { approvalUrl }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const approvalUrl = event.notification?.data?.approvalUrl || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.postMessage({ type: "navigate-approval", approvalUrl });
          client.navigate(approvalUrl);
          return client.focus();
        }
      }
      return clients.openWindow(approvalUrl);
    })
  );
});

self.addEventListener("push", (event) => {
  // Also notify open clients so they can refresh if already visible
  const payload = event.data ? event.data.json() : {};
  const approvalUrl = payload?.data?.approvalUrl || "/";
  
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        client.postMessage({ type: "new-intent", approvalUrl });
      }
    })
  );
});
