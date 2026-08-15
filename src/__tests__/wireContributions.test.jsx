import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AppSlot from '../apps/AppSlot';
import { createSlotRegistry } from '../apps/slotRegistry';
import { installPluginHost } from '../apps/pluginHost';
import { wireContributions, findWindowSpec } from '../apps/wireContributions';

function freshHost(registry) {
  if (typeof window !== 'undefined') delete window.__AW_PLUGIN_HOST__;
  return installPluginHost({ registry });
}

describe('wireContributions — F6 Cap 2 keystone wiring', () => {
  it('registers declarative nav into core.nav / core.nav.workspace and opens its window', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const onOpenWindow = vi.fn();
    const contributions = {
      nav: [
        { app: 'git', id: 'git.nav', label: 'Git', opens: 'git.main' },            // default → core.nav
        { app: 'git', id: 'git.repos-nav', label: 'Repos', section: 'workspace', opens: 'git.repos' },
      ],
      windows: [], frontend: [],
    };

    const dispose = await wireContributions(contributions, host, { onOpenWindow, registry });

    render(<AppSlot slot="core.nav" registry={registry} />);
    render(<AppSlot slot="core.nav.workspace" registry={registry} />);
    const gitBtn = screen.getByRole('button', { name: 'Git' });
    const reposBtn = screen.getByRole('button', { name: 'Repos' });
    expect(gitBtn).toBeInTheDocument();
    expect(reposBtn).toBeInTheDocument();

    act(() => gitBtn.click());
    expect(onOpenWindow).toHaveBeenCalledWith('git.main', 'git');

    // dispose removes every registered contribution (no residue on re-fetch)
    act(() => dispose());
    expect(registry.getSlot('core.nav')).toEqual([]);
    expect(registry.getSlot('core.nav.workspace')).toEqual([]);
  });

  it('loads a signed component-mode plugin into its granted slot', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const mod = {
      register(h) { h.registerSlot('core.nav.workspace', () => 'RepoNav', { id: 'git:reponav' }); },
    };
    const contributions = {
      nav: [], windows: [],
      frontend: [{
        app: 'git', mode: 'component', signed: true,
        granted_permissions: ['ui:code', 'ui:slots:core.nav.workspace'],
        bundle_url: '/api/apps/git/ui/git-ui.mjs',
      }],
    };
    const dispose = await wireContributions(contributions, host, {
      registry, importer: async () => mod,
    });
    expect(registry.getSlot('core.nav.workspace').map((e) => e.id)).toEqual(['git:reponav']);

    act(() => dispose());
    expect(registry.getSlot('core.nav.workspace')).toEqual([]); // no residue
  });

  it('an unsigned component-mode plugin is downgraded (not loaded) and does not throw', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const contributions = {
      nav: [], windows: [],
      frontend: [{
        app: 'evil', mode: 'component', signed: false,
        granted_permissions: ['ui:code'], bundle_url: '/api/apps/evil/ui/x.mjs',
      }],
    };
    const dispose = await wireContributions(contributions, host, { registry, importer: async () => ({}) });
    expect(registry.size()).toBe(0); // effectiveMode → iframe, component load skipped
    act(() => dispose());
  });

  // The refresh-on-refocus regression: the nav used to be torn down and only
  // then rebuilt behind N awaited bundle fetches, so every app-contributed menu
  // item visibly disappeared and came back each time the browser regained
  // focus. `replace` must make the swap atomic — no observer, at any point,
  // sees an empty slot.
  it('replacing a generation never leaves the slot empty (no refresh flicker)', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const contributions = {
      nav: [{ app: 'git', id: 'git.nav', label: 'Git', opens: 'git.main' }],
      windows: [],
      frontend: [{
        app: 'tasks', mode: 'component', signed: true,
        granted_permissions: ['ui:code', 'ui:slots:core.nav'],
        bundle_url: '/api/apps/tasks/ui/tasks-ui.mjs',
      }],
    };
    const mod = {
      register(h) { h.registerSlot('core.nav', () => 'Tasks', { id: 'tasks:nav' }); },
    };
    // A slow bundle — the window the old code left the nav blank for.
    const importer = () => new Promise((res) => setTimeout(() => res(mod), 10));

    const first = await wireContributions(contributions, host, { registry, importer });
    expect(registry.getSlot('core.nav').map((e) => e.id)).toEqual(['git:nav:git.nav', 'tasks:nav']);

    // Record every snapshot the store emits across the refresh.
    const seen = [];
    const off = registry.subscribe(() => seen.push(registry.getSlot('core.nav').length));

    const second = await wireContributions(contributions, host, {
      registry, importer, replace: first,
    });

    off();
    expect(seen.length).toBeGreaterThan(0);           // the swap really happened
    expect(Math.min(...seen)).toBeGreaterThan(0);     // ...and never bottomed out at 0
    expect(registry.getSlot('core.nav').map((e) => e.id)).toEqual(['git:nav:git.nav', 'tasks:nav']);
    expect(second.incomplete).toBe(false);

    act(() => second());
    expect(registry.getSlot('core.nav')).toEqual([]); // old generation left no residue
  });

  it('flags an incomplete generation when a bundle fails, and keeps the rest', async () => {
    const registry = createSlotRegistry();
    const host = freshHost(registry);
    const contributions = {
      nav: [{ app: 'git', id: 'git.nav', label: 'Git', opens: 'git.main' }],
      windows: [],
      frontend: [{
        app: 'tasks', mode: 'component', signed: true,
        granted_permissions: ['ui:code', 'ui:slots:core.nav'],
        bundle_url: '/api/apps/tasks/ui/tasks-ui.mjs',
      }],
    };
    const dispose = await wireContributions(contributions, host, {
      registry, importer: async () => { throw new Error('bundle fetch failed: 502'); },
    });
    expect(dispose.incomplete).toBe(true);
    expect(registry.getSlot('core.nav').map((e) => e.id)).toEqual(['git:nav:git.nav']);
    act(() => dispose());
  });

  it('findWindowSpec returns the inlined declarative spec by id', () => {
    const contributions = {
      windows: [{
        app: 'git', id: 'git.main', title: 'Git & GitHub CLI',
        body: { type: 'declarative', spec_data: { regions: [{ id: 'r', widgets: [] }] } },
      }],
    };
    const found = findWindowSpec(contributions, 'git.main');
    expect(found.title).toBe('Git & GitHub CLI');
    expect(found.spec.regions).toHaveLength(1);
    expect(findWindowSpec(contributions, 'nope')).toBeNull();
  });

  it('findWindowSpec preserves managed window body metadata', () => {
    const contributions = {
      windows: [{
        app: 'browser', id: 'browser.main', title: 'Browser', icon: 'globe',
        body: { type: 'managed_app', kind: 'browser', path: '/vnc.html?autoconnect=true' },
      }],
    };
    const found = findWindowSpec(contributions, 'browser.main');
    expect(found.app).toBe('browser');
    expect(found.icon).toBe('globe');
    expect(found.spec).toBeNull();
    expect(found.body).toEqual({ type: 'managed_app', kind: 'browser', path: '/vnc.html?autoconnect=true' });
  });
});
