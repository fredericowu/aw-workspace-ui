// The shell's side of live UI updates for open app windows (phase 2), kept out
// of App.jsx so it can be unit-tested: which windows pin an old app generation,
// which need a hint/tombstone, and what closing / minimizing / restoring one
// does to the plugin runtime.
//
//   * Only OPEN windows pin or hint. A minimized window is released exactly
//     like a closed one, so it never keeps old code alive; restoring it is a
//     fresh open (its spec snapshot is re-resolved from the latest payload).
//   * Releasing a pinning window tells the plugin runtime to re-evaluate NOW
//     (`aw-apps-changed`): the payload is byte-identical so nothing else would
//     make it load the new code.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  openAppSpecs, staleAppWindowKeys, retainedAppSlugs, attentionWindowKeys, isStaleWindowSpec,
} from './appGenerations';

const NO_APPS = new Set();

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

export function useAppWindowGenerations({ appWindowSpecs, setAppWindowSpecs, openWindows }) {
  const [liveRevs, setLiveRevs] = useState(null);
  // Latest payload the plugin runtime fetched (via onApplied), for restoreWindow.
  const latestRef = useRef(null);
  const [failedApps, setFailedApps] = useState(NO_APPS);

  const openSpecs = useMemo(() => openAppSpecs(appWindowSpecs, openWindows), [appWindowSpecs, openWindows]);
  const staleKeys = useMemo(
    () => staleAppWindowKeys(openSpecs, { app_revs: liveRevs }),
    [openSpecs, liveRevs],
  );
  const attention = useMemo(
    () => attentionWindowKeys(openSpecs, liveRevs ? { app_revs: liveRevs } : null, failedApps),
    [openSpecs, liveRevs, failedApps],
  );

  // Refs mirror the above for callbacks that must read them synchronously (the
  // plugin runtime's retain decision, window release).
  const openRef = useRef(openWindows);
  const openSpecsRef = useRef({});
  const staleKeysRef = useRef(NO_APPS);
  useEffect(() => {
    openRef.current = openWindows;
    openSpecsRef.current = openSpecs;
    staleKeysRef.current = staleKeys;
  }, [openWindows, openSpecs, staleKeys]);

  const getRetainedApps = useCallback((contributions) => retainedAppSlugs(openSpecsRef.current, contributions), []);
  const onApplied = useCallback((contributions) => {
    latestRef.current = contributions || null;
    setLiveRevs(contributions?.app_revs || null);
  }, []);
  const onWired = useCallback(({ failedApps: failed } = {}) => {
    const next = new Set(failed || []);
    setFailedApps((prev) => (sameSet(prev, next) ? prev : next));
  }, []);

  // The window left the open set (closed OR minimized/hidden). If it pinned an
  // old generation, drop it from the synchronous view and make the runtime
  // re-check, which loads the new code once nothing else pins it.
  const releaseWindow = useCallback((key) => {
    if (!staleKeysRef.current.has(key)) return;
    const rest = { ...openSpecsRef.current };
    delete rest[key];
    openSpecsRef.current = rest;
    window.dispatchEvent(new CustomEvent('aw-apps-changed', { detail: { revision: null } }));
  }, []);

  // A minimized window is coming back: that is a fresh open, so a snapshot that
  // fell behind its app is replaced with the latest one. If the app is gone the
  // old snapshot stays and the tombstone explains it.
  const restoreWindow = useCallback((key) => {
    const contributions = latestRef.current;
    if (!contributions) return;
    setAppWindowSpecs((prev) => {
      const spec = prev[key];
      if (!isStaleWindowSpec(spec, contributions)) return prev;
      const win = (contributions.windows || []).find((w) => w.id === spec.id);
      if (!win) return prev;
      const fresh = {
        ...spec,
        app: win.app,
        icon: win.icon,
        body: win.body || {},
        spec: win.body?.spec_data || null,
        rev: contributions.app_revs?.[win.app],
      };
      return { ...prev, [key]: fresh };
    });
  }, [setAppWindowSpecs]);

  // Tray toggle: an open window is hidden (released), a hidden one is restored.
  const noteToggle = useCallback((key) => {
    if (openRef.current?.has(key)) releaseWindow(key);
    else restoreWindow(key);
  }, [releaseWindow, restoreWindow]);

  return { staleKeys, attention, getRetainedApps, onApplied, onWired, releaseWindow, restoreWindow, noteToggle };
}
