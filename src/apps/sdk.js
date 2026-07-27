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
// host's React + fetch so plugins never import their own copy.
export function makeSdk({ React, ReactDOM, apiFetch }) {
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
    },
  };
}
