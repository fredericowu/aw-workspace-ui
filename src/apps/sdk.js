// @aw/plugin-sdk — the small surface a component-mode plugin bundle sees.
//
// A plugin bundle is built in Vite lib mode with `react`, `react-dom`, and this
// SDK EXTERNALIZED; at runtime those externals resolve through the host global
// `window.__AW_PLUGIN_HOST__` (installed by pluginHost.js), so there is exactly
// ONE React instance — no import-map / module-federation machinery. The bundle's
// default (or named) export is `register(host)`; everything it registers goes
// through the app-scoped `host` handle it's given, which is what makes unmount
// clean.
//
// This module is intentionally tiny and dependency-light: React comes from the
// host, not bundled here.

// Version of the contribution API a host advertises; a bundle can feature-detect.
export const PLUGIN_API_VERSION = 1;

// Build the SHARED SDK object exposed on the host global. `deps` carries the
// host's React + fetch + wsUrl builder so plugins never import their own copy
// nor hand-build a WebSocket URL (that class of bug caused the BYOD WS tunnel
// breakage — see project_byod_ws_tunnel_fix).
export function makeSdk({ React, ReactDOM, apiFetch, wsUrl, createSharedSocket }) {
  return {
    version: PLUGIN_API_VERSION,
    React,
    ReactDOM,
    // React.createElement shorthand for plugins authored without JSX.
    h: (...args) => React.createElement(...args),
    // Namespaced fetch to the app's own backend (`/api/apps/<slug>/…`), routed
    // to the BYOD workspace API by the global fetch shim (apiBase.js).
    api: {
      fetch: (path, init) => apiFetch(path, init),
      // Base-aware ws(s):// URL for an app WS route (`/api/apps/<slug>/ws`),
      // pointed at the same workspace API origin the fetch shim rewrites to
      // (BYOD `api.<ws>.workspace`). The apex `aw_id_jwt` cookie authorizes the
      // handshake, so plugins never build the URL — or append the token — by hand.
      wsUrl: (path) => (typeof wsUrl === 'function' ? wsUrl(path) : path),
    },
    // The aw-ws/1 shared client (docs/standards/app-backend-websocket-messaging.md
    // §7) — a plugin bundle can't import hooks/useSharedSocket.js directly (no
    // aw-workspace-ui internals across the bundle boundary), so it's handed the
    // same function through here instead of re-deriving reconnect/backoff/
    // close-code rules per app.
    ws: {
      createSharedSocket: (opts) => createSharedSocket(opts),
    },
  };
}
