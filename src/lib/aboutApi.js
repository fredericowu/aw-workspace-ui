// Settings > About data sources. Three independent sources, each may fail on
// its own: core facts (/api/about), the cloud management plane (aw-backend
// /versions + /update) and the desktop loopback bridge (/desktop/v1/*).
import { apiFetch } from '../auth';
import { centralApiUrl, isWorkspaceSpa, workspaceSlug } from '../apiBase';

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || body?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Core facts. A core without the route (404) falls back to /api/health for
 *  the version only; `legacy: true` tells the UI to label resources
 *  "needs a newer workspace core". */
export async function fetchCoreAbout() {
  const res = await apiFetch('/api/about');
  if (res.status === 404) {
    const h = await apiFetch('/api/health').then(readJson);
    return {
      legacy: true,
      version: { core: h.version || '', git_head: h.git_head || '', started_at: h.started_at || 0 },
    };
  }
  return readJson(res);
}

export async function fetchHealthVersion() {
  const h = await apiFetch('/api/health').then(readJson);
  return h.version || '';
}

/** Desktop bridge probe. Only a JSON body with kind "aw-desktop" counts: any
 *  other host answers the path with the SPA's 200 text/html fallback. */
export async function probeDesktop() {
  try {
    const res = await fetch('/desktop/v1/about', { credentials: 'omit' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('application/json')) return null;
    const body = await res.json();
    return body && body.kind === 'aw-desktop' ? body : null;
  } catch {
    return null;
  }
}

/** Asks aw-desktop to OPEN its existing upgrade confirm modal. Never upgrades. */
export async function requestDesktopUpgrade() {
  const res = await fetch('/desktop/v1/upgrade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export function cloudSlug() {
  return isWorkspaceSpa() ? workspaceSlug() : null;
}

export async function fetchCloudVersions(slug) {
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(slug)}/versions`);
  return apiFetch(url).then(readJson);
}

/** The single mutating call. REJECTS with err.status/err.body on failure. */
export async function updateCloudWorkspace(slug, { force = false } = {}) {
  const q = force ? '?force=true' : '';
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(slug)}/update${q}`);
  return apiFetch(url, { method: 'POST' }).then(readJson);
}

export function consoleManageUrl(slug) {
  try {
    const u = new URL(centralApiUrl('/'));
    const apex = u.hostname.replace(/^api\./, '');
    return `${u.protocol}//console.${apex}/workspaces/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}
