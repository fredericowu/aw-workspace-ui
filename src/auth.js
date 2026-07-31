
import { consoleLogoutUrl, identityLogoutUrl } from './apiBase';

let _popupView = null;

export function initAuth() {
  const params = new URLSearchParams(window.location.search);
  _popupView = params.get('view') || null;
  // Clean legacy api-key from URL if present (backward compat)
  if (params.has('api-key')) {
    params.delete('api-key');
    const clean = params.toString();
    const newUrl = window.location.pathname + (clean ? '?' + clean : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }
}

export function getPopupView() {
  return _popupView;
}

// A plain `fetch()` throws exactly this (TypeError, message "Failed to
// fetch") when the connection drops before any response arrives — no HTTP
// status is ever returned, so callers can't tell it apart from a real
// failure without this check.
function isDroppedConnectionError(e) {
  return e instanceof TypeError && /fetch/i.test(String(e?.message || ''));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const AUTH_STATUS_RETRY_ATTEMPTS = 3;
const AUTH_STATUS_RETRY_DELAY_MS = 500;

/** Check auth state with the server. Returns {authenticated, mode}.
 *  `authenticated` is `null` when the check itself couldn't be completed
 *  (server unreachable) — distinct from a real `false`, which only comes
 *  from a reachable server explicitly saying "not logged in". On a
 *  workspace SPA host this call is tunneled through the BYOD /link bridge
 *  (see apiBase.js), which returns a 502 "workspace offline" any time
 *  aw-backend or the workspace container itself restarts/redeploys — an
 *  expected, recurring event, not a real logout. Retrying (like apiFetch
 *  already does for /api/apps/* routes) turns most of these into a
 *  half-second delay instead of wrongly kicking the user to the login
 *  screen. Callers must treat `null` as "keep current state", not as
 *  unauthenticated. */
export async function getAuthStatus() {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch('/api/auth/status', { credentials: 'include' });
      if (res.ok) return await res.json();
      if (res.status >= 500) {
        attempt += 1;
        if (attempt < AUTH_STATUS_RETRY_ATTEMPTS) {
          await sleep(AUTH_STATUS_RETRY_DELAY_MS * attempt);
          continue;
        }
        return { authenticated: null, mode: 'password' };
      }
      return { authenticated: false, mode: 'password' };
    } catch (e) {
      attempt += 1;
      if (isDroppedConnectionError(e) && attempt < AUTH_STATUS_RETRY_ATTEMPTS) {
        await sleep(AUTH_STATUS_RETRY_DELAY_MS * attempt);
        continue;
      }
      return { authenticated: null, mode: 'password' };
    }
  }
}

/** Login with password. Returns true on success, error string on failure. */
export async function login(password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    return data.message || 'Login failed';
  } catch {
    return 'Network error';
  }
}

/** Login as a scoped guest user. Returns {ok, apps, message}. */
export async function guestLogin(username, password) {
  try {
    const res = await fetch('/api/auth/guest-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, apps: data.apps || [] };
    return { ok: false, message: data.message || 'Login failed' };
  } catch {
    return { ok: false, message: 'Network error' };
  }
}

/** Logout — clears the JWT cookie server-side. */
export async function logout() {
  const consoleLogout = consoleLogoutUrl();
  if (consoleLogout) {
    window.location.assign(consoleLogout);
    return;
  }
  const centralLogout = identityLogoutUrl();
  await fetch(centralLogout || '/api/auth/logout', { method: 'POST', credentials: 'include' });
}

const APP_ROUTE_RE = /\/api\/apps\//;
const APP_RETRY_ATTEMPTS = 3;
const APP_RETRY_DELAY_MS = 500;

export async function apiFetch(url, options = {}) {
  const isAppRoute = APP_ROUTE_RE.test(url);
  let res;
  let attempt = 0;
  // Every /api/apps/<slug>/... request is tunneled through the BYOD
  // workspace's own /link WebSocket (workspace_tunnel_proxy.py), which gets
  // torn down and re-established any time aw-backend or the workspace
  // container itself restarts/redeploys — an expected, recurring event, not
  // an outage. A request in flight at that exact moment loses its response
  // with no HTTP status at all (a bare "Failed to fetch"), even though the
  // framework's own app actions (install/update/config save/uninstall) are
  // idempotent by design (job-tracked or plain overwrites) — so retrying
  // the SAME request a few times is safe and turns most of these into a
  // half-second delay instead of a scary, misleading error.
  while (true) {
    try {
      res = await fetch(url, { credentials: 'include', ...options });
      break;
    } catch (e) {
      attempt += 1;
      if (!isAppRoute || !isDroppedConnectionError(e) || attempt >= APP_RETRY_ATTEMPTS) throw e;
      await sleep(APP_RETRY_DELAY_MS * attempt);
    }
  }
  // A 401 from an app-proxied route (/api/apps/<slug>/...) reflects THAT
  // app's own auth surface (e.g. mcp-gateway's admin/config also checks its
  // own bearer token) — it does not mean the workspace session itself is
  // invalid. Only a 401 from the framework's own API should force the whole
  // dashboard into a logged-out state; otherwise opening one misbehaving
  // app's settings panel wrongly logs the user out of everything.
  if (res.status === 401 && !isAppRoute) {
    window.dispatchEvent(new Event('aw-auth-failed'));
  }
  return res;
}

export function wsUrl(path) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  // Cookies are sent automatically on same-origin WS upgrade — no api-key needed
  return `${proto}//${host}${path}`;
}

// ---- Legacy stubs (kept so old callers compile) ----
export function getApiKey() { return ''; }
export function setApiKey() {}
export function clearApiKey() {}
export function initApiKey() { return initAuth(); }
