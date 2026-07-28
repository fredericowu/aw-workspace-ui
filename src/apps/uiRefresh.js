// Cross-component signal for a "this app changed something that only shows
// up after a real page load" reload — nav entries, slot contributions, or a
// component-mode frontend bundle contributed via aw-app.json's `contributes`
// (ADR Decision 3b). `GET /api/apps/-/contributions` gets refetched live,
// but nothing currently re-mounts nav/slots from a stale fetch without an
// actual reload, so an app that touches those must say so explicitly via
// its manifest's `requires_ui_refresh: true` (see `Manifest.requires_ui_refresh`
// in aw-workspace) rather than the SPA guessing.
//
// sessionStorage (not component state) because the signal has to survive
// from install/config-save time — while the Apps panel is still open — to
// panel-close time, which can be a different component (AppLauncher sets it,
// AppsNav consumes it) and even a route change in between.
const KEY = 'aw_pending_ui_refresh';

export function markUiRefreshNeeded() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable — reload just won't fire */ }
}

export function consumeUiRefreshNeeded() {
  try {
    const needed = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
    return needed;
  } catch {
    return false;
  }
}

// Full navigation reload with a cache-busting `?refresh=<random>` query
// param — a real `window.location` change, not `location.reload()`, so a
// stale cached document (CDN/browser) doesn't shadow the just-installed
// app's new contribution. Distinct from appsApi.js's `?refresh=true` (a
// server-side catalog-cache bypass on a plain `fetch()`, not a navigation).
export function reloadForUiRefresh() {
  const url = new URL(window.location.href);
  url.searchParams.set('refresh', String(Math.floor(Math.random() * 1e9)));
  window.location.href = url.toString();
}
