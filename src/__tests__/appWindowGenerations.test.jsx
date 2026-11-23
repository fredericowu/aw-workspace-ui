import { render, screen, act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';

import {
  openAppSpecs, isRemovedWindowSpec, attentionWindowKeys,
} from '../apps/appGenerations';
import { useAppWindowGenerations } from '../apps/useAppWindowGenerations';
import AppSlot from '../apps/AppSlot';
import { createSlotRegistry } from '../apps/slotRegistry';
import { installPluginHost } from '../apps/pluginHost';
import { wireContributions } from '../apps/wireContributions';
import BasicWindow from '../components/BasicWindow';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('pure helpers', () => {
  it('openAppSpecs keeps only specs whose key is open', () => {
    const specs = { 'appwin:a': { app: 'a' }, 'appwin:b': { app: 'b' } };
    expect(Object.keys(openAppSpecs(specs, new Set(['appwin:a'])))).toEqual(['appwin:a']);
    expect(openAppSpecs(specs, new Set())).toEqual({});
  });

  it('removed needs a recorded rev AND an app_revs map that lacks the app', () => {
    const spec = { app: 'a', rev: 'r1' };
    expect(isRemovedWindowSpec(spec, { app_revs: { b: 'x' } })).toBe(true);
    expect(isRemovedWindowSpec(spec, { app_revs: { a: 'r2' } })).toBe(false);
    expect(isRemovedWindowSpec(spec, {})).toBe(false);          // older core
    expect(isRemovedWindowSpec(spec, null)).toBe(false);
    expect(isRemovedWindowSpec({ app: 'a' }, { app_revs: {} })).toBe(false); // no rev recorded
  });

  it('failed applies to component bodies only, removed wins over failed', () => {
    const specs = {
      'appwin:c': { app: 'c', rev: 'r', body: { type: 'component' } },
      'appwin:d': { app: 'd', rev: 'r', body: { type: 'declarative' } },
      'appwin:e': { app: 'e', rev: 'r', body: { type: 'component' } },
    };
    const m = attentionWindowKeys(specs, { app_revs: { c: 'r', d: 'r' } }, new Set(['c', 'd', 'e']));
    expect(m.get('appwin:c')).toBe('failed');
    expect(m.has('appwin:d')).toBe(false);
    expect(m.get('appwin:e')).toBe('removed');
  });
});

// Stateful harness: the hook owns nothing but derives from (specs, open set).
function useHarness(initialSpecs, initialOpen) {
  const [specs, setSpecs] = useState(initialSpecs);
  const [open, setOpen] = useState(new Set(initialOpen));
  const gens = useAppWindowGenerations({ appWindowSpecs: specs, setAppWindowSpecs: setSpecs, openWindows: open });
  return { gens, specs, open, setOpen, setSpecs };
}
const spec = (app, rev, extra = {}) => ({ id: `${app}.main`, app, rev, body: { type: 'component' }, ...extra });
const payload = (revs, windows = []) => ({ app_revs: revs, windows });

describe('useAppWindowGenerations', () => {
  let events;
  beforeEach(() => {
    events = vi.fn();
    window.addEventListener('aw-apps-changed', events);
    return () => window.removeEventListener('aw-apps-changed', events);
  });

  it('an open outdated window pins its app and shows the hint; the retain decision follows the open set', () => {
    const { result } = renderHook(() => useHarness({ 'appwin:a': spec('a', 'r1') }, ['appwin:a']));
    act(() => result.current.gens.onApplied(payload({ a: 'r2' })));
    expect([...result.current.gens.staleKeys]).toEqual(['appwin:a']);
    expect([...result.current.gens.getRetainedApps(payload({ a: 'r2' }))]).toEqual(['a']);
  });

  it('a MINIMIZED outdated window pins nothing and has no hint', () => {
    const { result } = renderHook(() => useHarness({ 'appwin:a': spec('a', 'r1') }, []));
    act(() => result.current.gens.onApplied(payload({ a: 'r2' })));
    expect(result.current.gens.staleKeys.size).toBe(0);
    expect(result.current.gens.getRetainedApps(payload({ a: 'r2' })).size).toBe(0);
  });

  it('releaseWindow of a pinning window drops the pin synchronously and tells the runtime once', () => {
    const { result } = renderHook(() => useHarness({ 'appwin:a': spec('a', 'r1') }, ['appwin:a']));
    act(() => result.current.gens.onApplied(payload({ a: 'r2' })));
    events.mockClear();
    act(() => result.current.gens.releaseWindow('appwin:a'));
    expect(events).toHaveBeenCalledTimes(1);
    // before React re-renders, the synchronous view already excludes it
    expect(result.current.gens.getRetainedApps(payload({ a: 'r2' })).size).toBe(0);
  });

  it('releaseWindow of a non-pinning window does not poke the runtime', () => {
    const { result } = renderHook(() => useHarness({ 'appwin:a': spec('a', 'r1') }, ['appwin:a']));
    act(() => result.current.gens.onApplied(payload({ a: 'r1' })));
    events.mockClear();
    act(() => result.current.gens.releaseWindow('appwin:a'));
    expect(events).not.toHaveBeenCalled();
  });

  it('noteToggle hides an open window (release) and restores a hidden one (fresh spec)', () => {
    const win = { id: 'a.main', app: 'a', title: 'A', body: { type: 'component' } };
    const { result } = renderHook(() => useHarness({ 'appwin:a': spec('a', 'r1', { id: 'a.main' }) }, ['appwin:a']));
    act(() => result.current.gens.onApplied({ ...payload({ a: 'r2' }, [win]) }));
    events.mockClear();
    // open -> hide
    act(() => result.current.gens.noteToggle('appwin:a'));
    expect(events).toHaveBeenCalledTimes(1);
    act(() => result.current.setOpen(new Set()));
    // hidden -> restore: snapshot re-resolved to the app's current rev
    act(() => result.current.gens.noteToggle('appwin:a'));
    expect(result.current.specs['appwin:a'].rev).toBe('r2');
    act(() => result.current.setOpen(new Set(['appwin:a'])));
    expect(result.current.gens.staleKeys.size).toBe(0);
  });

  it('restoreWindow leaves a window alone when its app is gone (the tombstone explains it)', () => {
    const { result } = renderHook(() => useHarness({ 'appwin:a': spec('a', 'r1') }, []));
    act(() => result.current.gens.onApplied(payload({ b: 'x' }, [])));
    act(() => result.current.gens.restoreWindow('appwin:a'));
    expect(result.current.specs['appwin:a'].rev).toBe('r1');
  });

  it('flags removed and failed open windows, and clears them when the state recovers', () => {
    const specs = { 'appwin:a': spec('a', 'r1'), 'appwin:b': spec('b', 'r1') };
    const { result } = renderHook(() => useHarness(specs, ['appwin:a', 'appwin:b']));
    act(() => result.current.gens.onApplied(payload({ a: 'r1' })));
    act(() => result.current.gens.onWired({ failedApps: ['a'] }));
    expect(result.current.gens.attention.get('appwin:a')).toBe('failed');
    expect(result.current.gens.attention.get('appwin:b')).toBe('removed');
    act(() => result.current.gens.onWired({ failedApps: [] }));
    act(() => result.current.gens.onApplied(payload({ a: 'r1', b: 'r1' })));
    expect(result.current.gens.attention.size).toBe(0);
  });
});

describe('BasicWindow attention', () => {
  const win = { id: 'a.main', app: 'a', body: { type: 'component' } };
  it('shows a chip and a tombstone body for a component window, hiding the updated hint', () => {
    render(<BasicWindow title="A" windowSpec={win} updated attention="removed" />);
    expect(screen.getByTestId('app-window-attention-hint')).toHaveTextContent('App removed');
    expect(screen.getByTestId('app-window-tombstone')).toHaveTextContent('uninstalled');
    expect(screen.queryByTestId('app-window-updated-hint')).toBeNull();
  });
  it('failed has its own wording; no attention means no chip and no tombstone', () => {
    const { rerender } = render(<BasicWindow title="A" windowSpec={win} attention="failed" />);
    expect(screen.getByTestId('app-window-attention-hint')).toHaveTextContent('App failed to load');
    rerender(<BasicWindow title="A" windowSpec={win} />);
    expect(screen.queryByTestId('app-window-attention-hint')).toBeNull();
    expect(screen.queryByTestId('app-window-tombstone')).toBeNull();
  });
  it('a declarative window gets the chip but keeps its snapshot body', () => {
    const decl = { id: 'a.main', app: 'a', body: { type: 'declarative' } };
    render(<BasicWindow title="A" windowSpec={decl} spec={{ type: 'stack', children: [] }} attention="removed" />);
    expect(screen.getByTestId('app-window-attention-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('app-window-tombstone')).toBeNull();
  });
});

function freshHost(registry) {
  delete window.__AW_PLUGIN_HOST__;
  return installPluginHost({ registry });
}
const fe = (app, v) => ({
  app, mode: 'component', signed: true,
  granted_permissions: ['ui:code', 'ui:slots:core.nav'],
  bundle_url: `/api/apps/${app}/ui/${v}.mjs`,
});
const modOf = (label) => ({ register(h) { h.registerSlot('core.nav', () => label, { id: `${label}:nav` }); } });

describe('wireContributions unchanged / failedApps', () => {
  it('an unchanged app is carried over without a fetch while a changed one reloads', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const importer = vi.fn(async (url) => modOf(url.split('/').pop().replace('.mjs', '')));
    const first = await wireContributions({ nav: [], windows: [], frontend: [fe('a', 'a1'), fe('b', 'b1')] }, host, { registry, importer });
    importer.mockClear();
    const second = await wireContributions(
      { nav: [], windows: [], frontend: [fe('a', 'a1'), fe('b', 'b2')] }, host,
      { registry, importer, replace: first, unchanged: new Set(['a']) },
    );
    expect(importer).toHaveBeenCalledTimes(1);
    expect(importer.mock.calls[0][0]).toContain('b2');
    expect(second.carriedApps).toEqual(['a']);
    expect(second.retainedApps).toEqual([]);   // carried but not window-pinned
    expect(second.mountedApps.sort()).toEqual(['a', 'b']);
    const { container } = render(<AppSlot slot="core.nav" registry={registry} />);
    expect(container.textContent).toContain('a1');
    expect(container.textContent).toContain('b2');
    expect(container.textContent).not.toContain('b1');
    act(() => second());
    expect(registry.getSlot('core.nav')).toEqual([]);
  });

  it('an app that has no previous mount is fetched even if marked unchanged', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const importer = vi.fn(async () => modOf('x'));
    const first = await wireContributions({ nav: [], windows: [], frontend: [] }, host, { registry, importer });
    await wireContributions({ nav: [], windows: [], frontend: [fe('a', 'a1')] }, host,
      { registry, importer, replace: first, unchanged: new Set(['a']) });
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('reports failed bundles (import error and register throw) and marks the wiring incomplete', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const importer = vi.fn(async (url) => {
      if (url.includes('/a/')) throw new Error('boom');
      if (url.includes('/b/')) return { register() { throw new Error('bad register'); } };
      return modOf('ok');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await wireContributions({ nav: [], windows: [], frontend: [fe('a', 'a1'), fe('b', 'b1'), fe('c', 'c1')] }, host, { registry, importer });
    warn.mockRestore();
    expect(w.failedApps.sort()).toEqual(['a', 'b']);
    expect(w.incomplete).toBe(true);
    expect(w.mountedApps).toEqual(['c']);
  });
});

describe('usePluginContributions per-app diff', () => {
  let wire; let payload; let usePluginContributions;
  beforeEach(async () => {
    vi.resetModules();
    payload = {
      revision: 'r1', nav: [], windows: [], frontend: [],
      app_revs: { a: 'a1', b: 'b1' },
    };
    // Stand-in for wireContributions that models mounts per app faithfully:
    // carried apps keep their recorded mount, others are "mounted" fresh.
    wire = vi.fn(async (c, _h, opts) => {
      const d = () => {};
      const apps = Object.keys(c.app_revs);
      const carried = apps.filter((s) => (opts.retain?.has(s) || opts.unchanged?.has(s)) && opts.replace?.hasApp?.(s));
      d.hasApp = (s) => apps.includes(s);
      d.carriedApps = carried;
      d.retainedApps = carried.filter((s) => opts.retain?.has(s));
      d.mountedApps = apps;
      d.failedApps = c.__fail || [];
      return d;
    });
    vi.doMock('../apps/wireContributions', () => ({ wireContributions: wire }));
    vi.doMock('../apps/appsApi', () => ({ fetchContributions: async () => structuredClone(payload) }));
    vi.doMock('../apps/liveUiUpdates', () => ({ startLiveUiUpdates: () => () => {} }));
    vi.doMock('../apps/pluginHost', () => ({ installPluginHost: () => { window.__AW_PLUGIN_HOST__ = {}; } }));
    vi.doMock('../apps/appEventHooks', () => ({ wireAppEventHooks: () => () => {} }));
    ({ usePluginContributions } = await import('../apps/usePluginContributions'));
  });
  const poke = async () => { act(() => window.dispatchEvent(new CustomEvent('aw-apps-changed'))); await settle(); };

  it('only the app whose rev moved is rewired; the others are passed as unchanged', async () => {
    renderHook(() => usePluginContributions());
    await settle();
    expect(wire).toHaveBeenCalledTimes(1);
    expect([...wire.mock.calls[0][2].unchanged]).toEqual([]);

    payload = { ...payload, revision: 'r2', app_revs: { a: 'a1', b: 'b2' } };
    await poke();
    expect(wire).toHaveBeenCalledTimes(2);
    expect([...wire.mock.calls[1][2].unchanged]).toEqual(['a']);

    // an app that appears is not "unchanged"; the others stay so
    payload = { ...payload, revision: 'r3', app_revs: { a: 'a1', b: 'b2', c: 'c1' } };
    await poke();
    expect([...wire.mock.calls[2][2].unchanged].sort()).toEqual(['a', 'b']);
  });

  it('a pinned app keeps its OLD recorded rev, so releasing reloads it (and only it)', async () => {
    let retained = new Set();
    renderHook(() => usePluginContributions({ getRetainedApps: () => retained }));
    await settle();
    retained = new Set(['a']);
    payload = { ...payload, revision: 'r2', app_revs: { a: 'a2', b: 'b1' } };
    await poke();
    expect([...wire.mock.calls[1][2].unchanged]).toEqual(['b']);
    // released with an identical payload: a is rebuilt (rev a2 != recorded a1)
    retained = new Set();
    await poke();
    expect(wire).toHaveBeenCalledTimes(3);
    expect([...wire.mock.calls[2][2].unchanged]).toEqual(['b']);
    // now both recorded at current revs: steady, no churn
    await poke();
    expect(wire).toHaveBeenCalledTimes(3);
  });

  it('a failed app is not recorded, so the retry rebuilds it; onWired reports failures then clears', async () => {
    const onWired = vi.fn();
    renderHook(() => usePluginContributions({ onWired }));
    payload = { ...payload, __fail: ['a'] };
    await settle();
    expect(onWired).toHaveBeenLastCalledWith({ failedApps: ['a'], incomplete: false });
  });
});
