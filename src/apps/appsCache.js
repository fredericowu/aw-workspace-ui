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
  return read(INSTALLED_KEY);
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
