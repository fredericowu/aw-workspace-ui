// Three-plane split (ADR: aw-three-plane-split-and-workspace-urls) API base.
//
// When the cloud static SPA is served at `<ws>.workspace.<domain>` it has NO
// same-origin backend (the edge only file_servers the build). Its data API —
// including the auth-status gate (`/api/auth/status`, served by aw-workspace
// against the offline-verified aw_id_jwt) — lives on the BYOD at
// `api.<ws>.workspace.<domain>`, reached via the /link tunnel. This module
// derives that origin from window.location and rewrites the SPA's same-origin
// `/api/*` and `/ws/*` calls to it, so the sprawl of relative
// `fetch('/api/...')` call sites keeps working unchanged.
//
// The cloud aw-backend (`api.<domain>`) remains the identity trust anchor:
// it mints the apex `aw_id_jwt` cookie at central login and publishes the
// JWKS that aw-workspace verifies against offline. The browser SPA itself
// doesn't call it directly in this milestone.
//
// On any NON-workspace host (the single-tenant dashboard at aw.tekflox.com,
// dev, previews) `deriveBases()` returns empty origins and the shims are a
// strict no-op — same-origin behavior exactly as before.

function deriveBases() {
  try {
    const host = window.location.hostname; // e.g. fredericowu.workspace.aw.tekflox.com
    // Match the BARE workspace SPA host: a single slug label directly before
    // `.workspace.`. `api.<slug>.workspace...` has `api.` in front so the
    // slug label isn't adjacent to `.workspace.` and this won't match it.
    const m = host.match(/^([^.]+)\.workspace\.(.+)$/);
    if (!m) return { api: '' };
    const slug = m[1];
    const apex = m[2]; // aw.tekflox.com
    const proto = window.location.protocol; // https:
    return {
      api: `${proto}//api.${slug}.workspace.${apex}`, // BYOD workspace API (via /link tunnel)
      // LAN fast-path (case a): same-apex `local.<slug>.workspace` name that
      // resolves — via a public route53 A record — to the workspace machine's
      // LAN IP when the browser is on that LAN, served by aw-remote-host's
      // local TLS terminator on :8443 with the same per-workspace wildcard
      // cert. Off-LAN the name still resolves to the (unreachable) LAN IP, so
      // the probe below fails fast and we stay on the tunnel API. Same origin
      // family / same cert / same cookie scope → no mixed content, no new
      // CORS. See docs/architecture/aw-workspace-lan-fastpath.md.
      local: `${proto}//local.${slug}.workspace.${apex}:${LAN_FASTPATH_PORT}`,
      slug, // e.g. fredericowu — used to derive per-app subdomains
      apex, // aw.tekflox.com — used to derive the console login host
    };
  } catch {
    return { api: '' };
  }
}

// High (non-privileged) port the workspace's local TLS terminator binds —
// mirrors aw-remote-host's lanfastpath.DefaultPort (macbook-fred's `aw` user
// has no root, so :443 isn't an option).
const LAN_FASTPATH_PORT = 8443;

const BASES = deriveBases();

// The API origin the shims currently route to. Starts on the tunnel API and
// is swapped to the LAN origin by probeLanFastPath() when it's reachable —
// mutated in place so the already-installed fetch/WebSocket shims pick up the
// change without reinstalling.
let activeApi = BASES.api;

/** True when the LAN fast-path is currently active (local origin reachable).
 *  Drives the "on LAN / unmetered" UI badge and the tunnel-metering exclusion. */
export function isLanFastPath() {
  return !!BASES.local && activeApi === BASES.local;
}

/** Probe the LAN fast-path health endpoint and switch the active API origin
 *  to it when reachable, or back to the tunnel API when not. Credentialed +
 *  same cert as the tunnel path, so a success means the browser can reach the
 *  workspace directly on the LAN. Short timeout so an off-LAN visit (name
 *  resolves to an unreachable private IP) falls back fast. Safe to call
 *  repeatedly — wire it to network-change events to re-evaluate. */
export async function probeLanFastPath() {
  if (!BASES.api || !BASES.local) return false;
  const prev = activeApi;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const resp = await fetch(`${BASES.local}/api/health`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    activeApi = resp.ok ? BASES.local : BASES.api;
  } catch {
    activeApi = BASES.api; // unreachable / cert / CORS failure → stay on tunnel
  }
  if (activeApi !== prev) {
    try {
      window.dispatchEvent(new CustomEvent('aw:lan-fastpath', { detail: { active: isLanFastPath() } }));
    } catch { /* no-op */ }
  }
  return isLanFastPath();
}

/** True when this SPA is running as a cloud workspace SPA (has a remote API). */
export function isWorkspaceSpa() {
  return !!BASES.api;
}

/** Absolute external URL for a workspace app's own subdomain
 *  (`<appId>.app.<slug>.workspace.<apex>`), the Caddy-routed host every
 *  container/Tier-2 app answers on directly (`*.app.<slug>.workspace.{domain}`
 *  — see workspace_caddy_template.py). Derives `<slug>`/`<apex>` from
 *  window.location the same way deriveBases() does — never hardcode a slug.
 *  Returns null on a non-workspace host (nothing to derive it from).
 *
 *  TODO(fast-lane): no per-app LAN terminator exists yet (only the API
 *  fast-path on `local.<slug>.workspace...:8443` does) — this always returns
 *  the external/tunnel subdomain today, fast-path or not. See
 *  docs/architecture/aw-workspace-lan-fastpath.md. */
export function appSubdomainUrl(appId) {
  if (!BASES.apex || !BASES.slug) return null;
  return `${window.location.protocol}//${appId}.app.${BASES.slug}.workspace.${BASES.apex}`;
}

/** Console login URL (`https://console.<apex>/login?return=<here>`) for the
 *  current workspace SPA host, or `null` on a non-workspace host. Identity is
 *  owned by the console (three-plane split) — the workspace SPA has no login
 *  of its own, so an unauthenticated visit bounces here and the console
 *  redirects back after auth (safe-return-url guarded, subdomains of the apex
 *  only). */
export function consoleLoginUrl() {
  if (!BASES.api || !BASES.apex) return null;
  const ret = encodeURIComponent(window.location.href);
  return `${window.location.protocol}//console.${BASES.apex}/login?return=${ret}`;
}

/** Absolute URL for a same-origin `/api/*` or `/ws/*` path, routed to the
 *  workspace API. On a non-workspace host, returns the path unchanged
 *  (same-origin). */
export function apiUrl(path) {
  if (!BASES.api) return path;
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  if (path.startsWith('/api/') || path.startsWith('/ws/')) return activeApi + path;
  return path;
}

/** ws(s):// URL for a `/ws/*` (or `/api/*`) path on the workspace API. */
export function wsBaseUrl(path) {
  const base = activeApi || `${window.location.protocol}//${window.location.host}`;
  const abs = base.startsWith('http') ? base.replace(/^http/, 'ws') : base;
  return abs + path;
}

// ---- Global shims (only active on a workspace SPA host) ------------------

export function installApiBaseShims() {
  if (!BASES.api) return; // no-op on the single-tenant dashboard / dev / previews

  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      const rewritten = apiUrl(input);
      // When we transparently rewrite a same-origin `/api/*` path to the
      // cross-origin workspace API host, the browser would stop sending the
      // aw_id_jwt cookie by default (cross-origin requests default to
      // credentials:'omit'). Every call site wrote `fetch('/api/...')` assuming
      // same-origin cookie behavior — including raw fetches in declarative app
      // windows (AppWindow.jsx) that don't go through apiFetch — so preserve it.
      // An explicit `credentials` in `init` still wins (spread last).
      if (rewritten !== input) {
        return origFetch(rewritten, { credentials: 'include', ...init });
      }
      return origFetch(rewritten, init);
    }
    return origFetch(input, init);
  };

  const OrigWS = window.WebSocket;
  const spaHost = window.location.host;
  function PatchedWS(url, protocols) {
    try {
      if (typeof url === 'string') {
        const u = new URL(url, window.location.href);
        // Only rewrite our own same-host /ws or /api upgrades.
        if (u.host === spaHost && (u.pathname.startsWith('/ws') || u.pathname.startsWith('/api'))) {
          url = wsBaseUrl(u.pathname + u.search);
        }
      }
    } catch {
      /* leave url unchanged on parse failure */
    }
    return protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
  }
  PatchedWS.prototype = OrigWS.prototype;
  PatchedWS.CONNECTING = OrigWS.CONNECTING;
  PatchedWS.OPEN = OrigWS.OPEN;
  PatchedWS.CLOSING = OrigWS.CLOSING;
  PatchedWS.CLOSED = OrigWS.CLOSED;
  window.WebSocket = PatchedWS;

  // Kick off the LAN fast-path probe (non-blocking — the tunnel API works
  // regardless) and re-evaluate whenever the network changes, so moving on/off
  // the workspace LAN switches the active origin without a reload.
  probeLanFastPath();
  window.addEventListener('online', probeLanFastPath);
  window.addEventListener('focus', probeLanFastPath);
}
