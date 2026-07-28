// Apps-framework HTTP surface the Apps view consumes. Thin wrappers over the
// aw-workspace endpoints (F1–F5); relative `/api/*` is rewritten to the BYOD
// workspace API by the apiBase.js global shim.
import { apiFetch } from '../auth';

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

// GET /api/apps — installed apps (with has_config / config_schema / frontend).
export function listInstalledApps() {
  return apiFetch('/api/apps').then(json);
}

// GET /api/apps/-/catalog — marketplace catalog (available apps).
export function fetchCatalog(refresh = false) {
  return apiFetch(`/api/apps/-/catalog${refresh ? '?refresh=true' : ''}`).then(json);
}

// GET /api/apps/-/contributions — frontend contributions (declarative + code).
export function fetchContributions() {
  return apiFetch('/api/apps/-/contributions').then(json);
}

// POST /api/apps/install — kicks off a catalog app install (repo/ref, F3
// flow) in the BACKGROUND; returns immediately with {app_id, status:
// "installing"} (202) instead of blocking on the fetch + apt install, which
// takes long enough for the BYOD tunnel to drop the request. Poll
// getInstallStatus() for progress.
export function installApp({ repo, ref, app_id, granted_permissions, signed, config }) {
  return apiFetch('/api/apps/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, ref, app_id, granted_permissions, signed, config }),
  }).then(json);
}

// GET /api/apps/{slug}/install-status — poll a background install kicked off
// by installApp(). status is "installing" | "installed" | "failed" (+ error).
export function getInstallStatus(slug) {
  return apiFetch(`/api/apps/${encodeURIComponent(slug)}/install-status`).then(json);
}

// DELETE /api/apps/{slug} — hot-uninstall (drain + journal reverse-replay).
export function uninstallApp(slug) {
  return apiFetch(`/api/apps/${encodeURIComponent(slug)}`, { method: 'DELETE' }).then(json);
}

// POST /api/apps/{slug}/update — bump an installed app to the catalog's
// current version (app-update-mechanism ADR). Same async job contract as
// installApp: kicks off in the background and returns immediately; poll
// getInstallStatus(slug) for progress/completion.
export function updateApp(slug) {
  return apiFetch(`/api/apps/${encodeURIComponent(slug)}/update`, { method: 'POST' }).then(json);
}

// POST /api/apps/install-my-apps — reconcile the user's registry into this ws.
export function installMyApps() {
  return apiFetch('/api/apps/install-my-apps', { method: 'POST' }).then(json);
}

// GET /api/apps/{slug}/versions — tagged release history for the pin/rollback
// Version window: {slug, installed_version, catalog_version, versions:[{ref,version}]}.
export function getAppVersions(slug) {
  return apiFetch(`/api/apps/${encodeURIComponent(slug)}/versions`).then(json);
}

// POST /api/apps/{slug}/version — pin/rollback to an explicit tagged ref
// (older or newer than what's installed). Same async job contract as
// installApp/updateApp: kicks off in the background, poll getInstallStatus().
export function setAppVersion(slug, { ref, version }) {
  return apiFetch(`/api/apps/${encodeURIComponent(slug)}/version`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, version }),
  }).then(json);
}
