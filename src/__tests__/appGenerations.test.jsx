import { render, screen, act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { appRevOf, isStaleWindowSpec, staleAppWindowKeys, retainedAppSlugs } from '../apps/appGenerations';
import AppSlot from '../apps/AppSlot';
import { createSlotRegistry } from '../apps/slotRegistry';
import { installPluginHost } from '../apps/pluginHost';
import { wireContributions, findWindowSpec, findAppDefaultWindow } from '../apps/wireContributions';
import BasicWindow from '../components/BasicWindow';

const C = (revs) => ({ app_revs: revs });

describe('appGenerations', () => {
  it('stale only when the window recorded a rev and the app rev moved', () => {
    expect(isStaleWindowSpec({ app: 'a', rev: 'r1' }, C({ a: 'r2' }))).toBe(true);
    expect(isStaleWindowSpec({ app: 'a', rev: 'r1' }, C({ a: 'r1' }))).toBe(false);
    // old core (no app_revs) or a spec without a rev: never stale
    expect(isStaleWindowSpec({ app: 'a', rev: 'r1' }, {})).toBe(false);
    expect(isStaleWindowSpec({ app: 'a' }, C({ a: 'r2' }))).toBe(false);
    // uninstalled app is the tombstone slice, not "stale"
    expect(isStaleWindowSpec({ app: 'a', rev: 'r1' }, C({ b: 'x' }))).toBe(false);
    expect(appRevOf(C({ a: 5 }), 'a')).toBeUndefined();
  });

  it('keys and retained slugs only include windows of the app that moved', () => {
    const specs = {
      'appwin:a.main': { app: 'a', rev: 'r1' },
      'appwin:a.other:1': { app: 'a', rev: 'r1' },
      'appwin:b.main': { app: 'b', rev: 'q1' },
    };
    const now = C({ a: 'r2', b: 'q1' });
    expect([...staleAppWindowKeys(specs, now)].sort()).toEqual(['appwin:a.main', 'appwin:a.other:1']);
    expect([...retainedAppSlugs(specs, now)]).toEqual(['a']);
  });

  it('findWindowSpec / findAppDefaultWindow stamp the app rev on the snapshot', () => {
    const c = { app_revs: { a: 'r9' }, windows: [{ id: 'a.main', app: 'a', title: 'A', body: {} }] };
    expect(findWindowSpec(c, 'a.main').rev).toBe('r9');
    expect(findAppDefaultWindow(c, 'a').rev).toBe('r9');
  });
});

describe('BasicWindow updated hint', () => {
  const win = { id: 'a.main', app: 'a', body: { type: 'component' } };
  it('shows "Updated, reopen to apply" only when updated', () => {
    const { rerender } = render(<BasicWindow title="A" windowSpec={win} updated={false} />);
    expect(screen.queryByTestId('app-window-updated-hint')).toBeNull();
    rerender(<BasicWindow title="A" windowSpec={win} updated />);
    expect(screen.getByTestId('app-window-updated-hint')).toHaveTextContent('Updated, reopen to apply');
  });
});

function freshHost(registry) {
  delete window.__AW_PLUGIN_HOST__;
  return installPluginHost({ registry });
}
const fe = (v) => ({
  app: 'tasks', mode: 'component', signed: true,
  granted_permissions: ['ui:code', 'ui:slots:core.nav'],
  bundle_url: `/api/apps/tasks/ui/${v}.mjs`,
});
const modOf = (label) => ({
  register(h) { h.registerSlot('core.nav', () => label, { id: 'tasks:nav' }); },
});

describe('wireContributions retain: old code stays until released', () => {
  it('a retained app keeps its OLD mount and its new bundle is never fetched', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const mods = { v1: modOf('OLD'), v2: modOf('NEW') };
    const importer = vi.fn(async (url) => mods[url.includes('v2') ? 'v2' : 'v1']);
    const first = await wireContributions({ nav: [], windows: [], frontend: [fe('v1')] }, host, { registry, importer });
    render(<AppSlot slot="core.nav" registry={registry} />);
    expect(screen.getByText('OLD')).toBeInTheDocument();

    const second = await wireContributions(
      { nav: [], windows: [], frontend: [fe('v2')] }, host,
      { registry, importer, replace: first, retain: new Set(['tasks']) },
    );
    expect(importer).toHaveBeenCalledTimes(1);          // v2 never fetched
    expect(screen.getByText('OLD')).toBeInTheDocument(); // still the old code
    expect(second.retainedApps).toEqual(['tasks']);

    // The retained mount is owned by the new generation now: disposing it clears it.
    act(() => second());
    expect(registry.getSlot('core.nav')).toEqual([]);
  });

  it('without retain the new code replaces the old (nothing is leaked or doubled)', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const mods = { v1: modOf('OLD'), v2: modOf('NEW') };
    const importer = async (url) => mods[url.includes('v2') ? 'v2' : 'v1'];
    const first = await wireContributions({ nav: [], windows: [], frontend: [fe('v1')] }, host, { registry, importer });
    const second = await wireContributions(
      { nav: [], windows: [], frontend: [fe('v2')] }, host, { registry, importer, replace: first },
    );
    expect(registry.getSlot('core.nav')).toHaveLength(1);
    render(<AppSlot slot="core.nav" registry={registry} />);
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(second.retainedApps).toEqual([]);
  });

  it('declarative nav rows come from the NEW payload even while the app is retained', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const onOpenWindow = vi.fn();
    const importer = async () => modOf('OLD');
    const nav = (opens) => [{ app: 'tasks', id: 'tasks.nav', label: 'Tasks', opens }];
    const first = await wireContributions({ nav: nav('t.v1'), windows: [], frontend: [fe('v1')] }, host, { registry, importer, onOpenWindow });
    await wireContributions({ nav: nav('t.v2'), windows: [], frontend: [fe('v2')] }, host,
      { registry, importer, onOpenWindow, replace: first, retain: new Set(['tasks']) });
    render(<AppSlot slot="core.nav" registry={registry} />);
    act(() => screen.getByRole('button', { name: 'Tasks' }).click());
    expect(onOpenWindow).toHaveBeenLastCalledWith('t.v2', 'tasks');
  });
});

describe('usePluginContributions retain/release', () => {
  let wire; let payload; let usePluginContributions;
  beforeEach(async () => {
    vi.resetModules();
    payload = { revision: 'r1', nav: [], windows: [], frontend: [], app_revs: { tasks: 'a1' } };
    wire = vi.fn(async (_c, _h, opts) => {
      const d = () => {};
      d.retainedApps = [...(opts.retain || [])];
      return d;
    });
    vi.doMock('../apps/wireContributions', () => ({ wireContributions: wire }));
    vi.doMock('../apps/appsApi', () => ({ fetchContributions: async () => structuredClone(payload) }));
    vi.doMock('../apps/liveUiUpdates', () => ({ startLiveUiUpdates: () => () => {} }));
    vi.doMock('../apps/pluginHost', () => ({ installPluginHost: () => { window.__AW_PLUGIN_HOST__ = {}; } }));
    vi.doMock('../apps/appEventHooks', () => ({ wireAppEventHooks: () => () => {} }));
    ({ usePluginContributions } = await import('../apps/usePluginContributions'));
  });

  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it('rewires an unchanged payload exactly once when a retained app is released', async () => {
    let retained = new Set();
    const applied = vi.fn();
    renderHook(() => usePluginContributions({ getRetainedApps: () => retained, onApplied: applied }));
    await settle();
    expect(wire).toHaveBeenCalledTimes(1);

    retained = new Set(['tasks']);
    payload = { ...payload, revision: 'r2', app_revs: { tasks: 'a2' } };
    act(() => window.dispatchEvent(new CustomEvent('aw-apps-changed')));
    await settle();
    expect(wire).toHaveBeenCalledTimes(2);
    expect([...wire.mock.calls[1][2].retain]).toEqual(['tasks']);

    // still retained + unchanged payload: no churn
    act(() => window.dispatchEvent(new CustomEvent('aw-apps-changed')));
    await settle();
    expect(wire).toHaveBeenCalledTimes(2);

    // window closed -> released -> rewire with the new code, same payload
    retained = new Set();
    act(() => window.dispatchEvent(new CustomEvent('aw-apps-changed')));
    await settle();
    expect(wire).toHaveBeenCalledTimes(3);
    expect([...wire.mock.calls[2][2].retain]).toEqual([]);

    // and now it is steady again
    act(() => window.dispatchEvent(new CustomEvent('aw-apps-changed')));
    await settle();
    expect(wire).toHaveBeenCalledTimes(3);
    expect(applied).toHaveBeenCalled();
  });
});

import { specForOpen } from '../apps/appGenerations';
describe('specForOpen (menu click on an already-open, outdated window)', () => {
  it('keeps the old generation; a fresh or same-rev open takes the new snapshot', () => {
    const old = { id: 'w', rev: 'r1', title: 'old' };
    const next = { id: 'w', rev: 'r2', title: 'new' };
    expect(specForOpen(old, next)).toBe(old);
    expect(specForOpen(undefined, next)).toBe(next);
    expect(specForOpen({ id: 'w', rev: 'r2' }, next)).toBe(next);
    expect(specForOpen({ id: 'w' }, next)).toBe(next); // pre-phase-2 snapshot
  });
});
