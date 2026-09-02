// Stale-while-revalidate cache for the Apps view (AppLauncher/InstalledApps/
// AppsMarketplace). Holds the last-known GET /api/apps (installed) and
// GET /api/apps/-/catalog (marketplace) responses in localStorage so the
// Apps view can render instantly from last-known data on open instead of
// blocking on the network — callers still kick off a real fetch right after
// and overwrite both the in-memory state and this cache when it lands.
const INSTALLED_KEY = 'aw:apps:installed:v1';
const CATALOG_KEY = 'aw:apps:catalog:v1';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort cache — storage full/unavailable (private mode, quota) is
    // not worth surfacing, the view just falls back to network-only next time
  }
}

export function readCachedInstalled() {
  const value = read(INSTALLED_KEY);
  // A poisoned cache entry (e.g. written from a past `{}` fallback body — see
  // appsApi.js's json() helper) must not be handed to AppLauncher's synchronous
  // seed render as if it were a real list: `(installed || []).filter(...)` only
  // guards null/undefined, not "truthy non-array", and crashes to the
  // ErrorBoundary before the corrected live fetch ever gets a chance to
  // overwrite it. Falling back to null here reproduces the ordinary
  // no-cache-yet first-visit state, which AppLauncher already handles fine.
  return Array.isArray(value) ? value : null;
}

export function writeCachedInstalled(apps) {
  write(INSTALLED_KEY, apps);
}

export function readCachedCatalog() {
  return read(CATALOG_KEY);
}

export function writeCachedCatalog(catalog) {
  write(CATALOG_KEY, catalog);
}
