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
      api: `${proto}//api.${slug}.workspace.${apex}`, // BYOD workspace API
    };
  } catch {
    return { api: '' };
  }
}

const BASES = deriveBases();

/** True when this SPA is running as a cloud workspace SPA (has a remote API). */
export function isWorkspaceSpa() {
  return !!BASES.api;
}

/** Absolute URL for a same-origin `/api/*` or `/ws/*` path, routed to the
 *  workspace API. On a non-workspace host, returns the path unchanged
 *  (same-origin). */
export function apiUrl(path) {
  if (!BASES.api) return path;
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  if (path.startsWith('/api/') || path.startsWith('/ws/')) return BASES.api + path;
  return path;
}

/** ws(s):// URL for a `/ws/*` (or `/api/*`) path on the workspace API. */
export function wsBaseUrl(path) {
  const base = BASES.api || `${window.location.protocol}//${window.location.host}`;
  const abs = base.startsWith('http') ? base.replace(/^http/, 'ws') : base;
  return abs + path;
}

// ---- Global shims (only active on a workspace SPA host) ------------------

export function installApiBaseShims() {
  if (!BASES.api) return; // no-op on the single-tenant dashboard / dev / previews

  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return origFetch(apiUrl(input), init);
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
}
