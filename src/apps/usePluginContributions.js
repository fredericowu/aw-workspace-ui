// usePluginContributions — boot the decoupled-apps frontend plugin runtime
// (ADR F6 Capability 2) for whichever shell is mounted.
//
// WHY THIS IS A HOOK AND NOT AN EFFECT IN App.jsx
// ----------------------------------------------
// This bootstrap used to live inline in `AuthenticatedApp` — the DESKTOP shell.
// `App()` picks exactly one shell (`if (isMobile) return <MobileApp />`), so on
// mobile `AuthenticatedApp` never mounts, this effect never ran, and NO app's
// `.mjs` bundle was ever fetched. Every `core.window.body:<id>` slot MobileApp
// renders (presentations.viewer, diff-tool.viewer) therefore resolved to zero
// contributions and painted an empty window — not a rendering bug in the apps,
// the plugin runtime was simply never started on that route. Extracted here so
// both shells share ONE implementation: the sequencing below is load-bearing
// and hard-won (see the comments), and a second copy in MobileApp would rot the
// moment either is fixed.
//
// Note that `installPluginHost()` alone is NOT enough to fill a slot — it only
// builds the `window.__AW_PLUGIN_HOST__` global. `wireContributions()` is what
// fetches each app's bundle and runs its `register(host)`, which is what
// actually mounts anything into the slot registry.
import { useEffect, useRef } from 'react';

import { installPluginHost } from './pluginHost';
import { fetchContributions } from './appsApi';
import { wireContributions } from './wireContributions';
import { wireAppEventHooks } from './appEventHooks';

// The slot registry is a process-wide singleton, so wiring it twice would
// double-mount every contribution. Only one shell is ever mounted at a time
// today, but `isMobile` IS reactive (resize / #mobile / #desktop hashchange),
// so the two shells swap within a single session — this makes a concurrent
// second wiring a loud no-op instead of a silent duplicate. React StrictMode's
// dev double-invoke is mount→unmount→mount (never overlapping), so it counts
// down to 0 in between and the real mount still wires.
let activeWirings = 0;

/**
 * @param {object}   [opts]
 * @param {function} [opts.onOpenWindow] - (windowId) => void, for declarative
 *   nav entries. Omit on shells with their own window management (MobileApp
 *   drives its single active window off each app's own WebSocket, and does not
 *   render the `core.nav` slot at all, so nothing can call this there).
 * @param {function} [opts.onFirstLoad] - (contributions) => void, run once
 *   after the first successful wiring. The desktop shell uses it to rehydrate
 *   windows persisted in localStorage.
 * @returns {{current: object|null}} ref holding the latest contributions payload.
 */
export function usePluginContributions({ onOpenWindow, onFirstLoad } = {}) {
  const contributionsRef = useRef(null);

  // Kept current: a nav click can happen long after mount. Assigned in an
  // effect rather than during render — a nav click can only follow a paint,
  // so post-render is early enough, and writing a ref mid-render is exactly
  // what React's refs rule forbids.
  const onOpenWindowRef = useRef(onOpenWindow);
  useEffect(() => { onOpenWindowRef.current = onOpenWindow; });

  // Captured ONCE, deliberately not refreshed. The desktop rehydration reads
  // the `openWindows` snapshot from its mount-time closure on purpose (a later
  // refresh must not reopen a window the user has since closed), which is
  // exactly what the previous `[]`-deps effect gave it. A live ref here would
  // silently change that.
  const onFirstLoadRef = useRef(onFirstLoad);

  useEffect(() => {
    if (activeWirings > 0) {
      console.warn('[apps] plugin contributions already wired by another shell — skipping duplicate wiring');
      return undefined;
    }
    activeWirings += 1;

    installPluginHost();
    let disposed = false;
    let dispose = null;
    let disposeEventHooks = null;
    let signature = null;

    const run = async (isFirstLoad) => {
      let contributions;
      try {
        contributions = await fetchContributions();
      } catch {
        return; // no workspace API / not reachable — leave the shell unchanged
      }
      if (disposed) return;
      contributionsRef.current = contributions;

      // Skip the rewire cycle when nothing actually changed since the last time
      // this ran. Found 2026-08-04: this used to unconditionally dispose() then
      // re-wire on EVERY focus event (any tab switch, not just "left and
      // reopened the browser"), so every component-mode slot visibly vanished
      // and reappeared on each refocus even though nothing had changed.
      const nextSignature = JSON.stringify(contributions);
      if (!isFirstLoad && dispose && nextSignature === signature) return;

      // Hand the previous generation's disposer to wireContributions instead of
      // calling it here: it tears the old one down in the same synchronous tick
      // that mounts the new one, so the slots are never observably empty.
      const previous = dispose;
      dispose = null;
      const next = await wireContributions(contributions, window.__AW_PLUGIN_HOST__, {
        // Forward every arg — wireContributions calls this as
        // (entry.opens, entry.app), and swallowing the second here would
        // silently strip the app slug from any future caller that wants it.
        onOpenWindow: (...args) => onOpenWindowRef.current?.(...args),
        replace: previous || undefined,
      });
      const previousEventHooks = disposeEventHooks;
      const nextEventHooks = wireAppEventHooks(contributions, (action) => {
        onOpenWindowRef.current?.(action.window, action.app, action);
      });
      if (disposed) {
        try { next(); } catch { /* nothing left to keep */ }
        try { nextEventHooks(); } catch { /* nothing left to keep */ }
        return;
      }
      try { previousEventHooks?.(); } catch { /* replacement still proceeds */ }
      disposeEventHooks = nextEventHooks;
      dispose = next;
      // Only now, and only if every app made it in — an app whose bundle failed
      // to load must not have its absence frozen in as the steady state, or the
      // guard above short-circuits every later refresh and its nav stays gone
      // until a page reload.
      signature = next.incomplete ? null : nextSignature;

      if (isFirstLoad) {
        try { onFirstLoadRef.current?.(contributions); } catch (e) {
          console.warn('[apps] onFirstLoad failed:', e);
        }
      }
    };

    // Serialised: `focus` fires freely (alt-tab, devtools, an OS notification)
    // and can easily arrive while a load is still in flight. Two overlapping
    // runs both see `dispose === null`, so both bypass the unchanged-signature
    // guard, both rewire, and the loser's disposer is overwritten and never
    // called — a leak that also double-mounts the nav. One at a time instead.
    let inFlight = null;
    const load = (isFirstLoad) => {
      inFlight = (inFlight || Promise.resolve())
        .then(() => run(isFirstLoad))
        .catch(() => {}); // never poison the chain for the next refresh
      return inFlight;
    };

    load(true);
    const onChanged = () => load();
    window.addEventListener('aw-apps-changed', onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      disposed = true;
      activeWirings -= 1;
      window.removeEventListener('aw-apps-changed', onChanged);
      window.removeEventListener('focus', onChanged);
      if (dispose) { try { dispose(); } catch { /* tearing down anyway */ } }
      if (disposeEventHooks) { try { disposeEventHooks(); } catch { /* tearing down anyway */ } }
    };
  }, []);

  return contributionsRef;
}
