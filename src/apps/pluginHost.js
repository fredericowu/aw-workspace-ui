// Plugin Host — installs `window.__AW_PLUGIN_HOST__`, the single object a
// component-mode plugin bundle resolves its externals (React, SDK) and its
// registrations through (ADR Decision 3b).
//
// The GLOBAL host exposes the shared React instance + SDK + the slot registry.
// Each app is handed an APP-SCOPED handle (`hostForApp`) whose `registerSlot`/
// `registerWindow` auto-tag the contribution with the app's slug and enforce the
// per-slot `ui:slots:<id>` grant, and whose `onDispose` collects teardown fns.
// `register(host)` in the bundle receives this scoped handle, so disposing the
// app empties exactly what it registered — nothing else.

import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { slotRegistry as defaultRegistry } from './slotRegistry';
import { makeSdk, PLUGIN_API_VERSION } from './sdk';
import { wsBaseUrl, apiUrl as absoluteApiUrl } from '../apiBase';

// Default fetch used by the SDK — relative `/api/*` is rewritten to the BYOD
// workspace API by the apiBase.js global shim, so a plain fetch is correct.
function defaultApiFetch(path, init) {
  return fetch(path, { credentials: 'include', ...(init || {}) });
}

// Build (idempotently) and install the global host. Safe to call repeatedly;
// returns the existing global if already installed.
export function installPluginHost({ registry = defaultRegistry, apiFetch = defaultApiFetch, wsUrl = wsBaseUrl } = {}) {
  if (typeof window !== 'undefined' && window.__AW_PLUGIN_HOST__) {
    return window.__AW_PLUGIN_HOST__;
  }
  const sdk = makeSdk({ React, ReactDOM, apiFetch, wsUrl });
  const host = {
    version: PLUGIN_API_VERSION,
    React,
    ReactDOM,
    h: React.createElement,
    sdk,
    registry,
    // Low-level registry access (advanced plugins); most use the scoped handle.
    slots: registry,
    // Create the app-scoped handle a plugin's register(host) is actually given.
    forApp(app) {
      return hostForApp(host, app);
    },
  };
  if (typeof window !== 'undefined') window.__AW_PLUGIN_HOST__ = host;
  return host;
}

// App-scoped handle. `app` = { slug, grantedSlots?: string[], grantedAll?: bool }.
// grantedAll short-circuits the per-slot check (used in tests / fully-trusted
// core registrations); production passes the granted `ui:slots:<id>` set.
//
// `register(host)` (the bundle's entrypoint) may be HEADLESS: it's sanctioned
// to start background work — open a WS via `host.app.wsUrl(...)`, install
// listeners — without registering any slot at all, as long as every teardown
// goes through `host.onDispose(fn)` below. This is exactly the devctl client's
// shape (connect on load, no UI unless it also fills a slot like `core.nav`).
export function hostForApp(host, app) {
  const slug = app.slug || app.app;
  const grantedSlots = new Set(app.grantedSlots || []);
  const grantedAll = !!app.grantedAll;
  const disposers = [];

  function slotGranted(slotId) {
    if (grantedAll) return true;
    // An app may always fill its OWN slots and its own window bodies.
    if (slotId.startsWith(`${slug}.`)) return true;
    if (slotId.startsWith('core.window.body:') && slotId.includes(`:${slug}.`)) return true;
    return grantedSlots.has(slotId);
  }

  return {
    version: host.version,
    React: host.React,
    ReactDOM: host.ReactDOM,
    h: host.h,
    sdk: host.sdk,
    slug,

    // App-scoped URL helpers (ADR "Apps Own Their Front + Back Routes"
    // Decision 3) — how a frontend contribution talks to ITS OWN backend
    // without hand-building `/api/apps/<slug>/…` origins. Routed through
    // `sdk.api.fetch`/`wsUrl` so the BYOD apiBase.js rewrite still applies.
    app: {
      apiUrl: (sub) => `/api/apps/${slug}${sub}`,
      // Absolute (scheme+host-qualified) equivalent of apiUrl() — REQUIRED
      // for any DOM attribute the browser resolves directly (<iframe src>,
      // <a href>, window.open(...)) instead of through JS fetch/XHR. A
      // relative apiUrl() there resolves against the SPA's own host, not
      // the workspace API host, and 404s on BYOD (see the 2026-08-04
      // whiteboard iframe bug — apiBase.js's apiUrl() already solves this
      // for core code; plugins need it exposed too).
      absoluteApiUrl: (sub) => absoluteApiUrl(`/api/apps/${slug}${sub}`),
      fetch: (sub, init) => host.sdk.api.fetch(`/api/apps/${slug}${sub}`, init),
      wsUrl: (sub) => host.sdk.api.wsUrl(`/api/apps/${slug}${sub}`),
    },

    // Register a component into a named slot. `render(props)` → React node.
    registerSlot(slotId, render, opts = {}) {
      if (!slotGranted(slotId)) {
        // Honest boundary: an ungranted slot is a no-op with a console warning,
        // not a throw — one over-reaching contribution must never crash load().
        console.warn(`[apps] ${slug} not granted slot "${slotId}" — skipped`);
        return () => {};
      }
      const id = opts.id || `${slug}:${slotId}:${render.name || 'anon'}`;
      const off = host.registry.mount(slotId, {
        id, appId: slug, render, order: opts.order,
      });
      disposers.push(off);
      return off;
    },

    // Convenience: register the body component for one of this app's windows.
    registerWindow(windowId, render, opts = {}) {
      return this.registerSlot(`core.window.body:${windowId}`, render, opts);
    },

    onDispose(fn) {
      if (typeof fn === 'function') disposers.push(fn);
    },

    // Tear everything this app registered down (called by loadPlugin's dispose).
    dispose() {
      for (const fn of disposers.splice(0)) {
        try { fn(); } catch { /* keep disposing the rest */ }
      }
      host.registry.unmountApp(slug);
    },
  };
}
