import { describe, it, expect } from 'vitest';
import { effectiveMode, loadComponentPlugin } from '../apps/loadPlugin';
import { installPluginHost } from '../apps/pluginHost';
import { createSlotRegistry } from '../apps/slotRegistry';

describe('effectiveMode — trust-tier gate (Decision 3b/4)', () => {
  it('declarative always stays declarative', () => {
    expect(effectiveMode({ frontend: { mode: 'declarative' } })).toBe('declarative');
  });

  it('component is honored ONLY for a signed app granted ui:code', () => {
    expect(effectiveMode({
      frontend: { mode: 'component' }, signed: true, granted_permissions: ['ui:code'],
    })).toBe('component');
  });

  it('component downgrades to iframe when unsigned', () => {
    expect(effectiveMode({
      frontend: { mode: 'component' }, signed: false, granted_permissions: ['ui:code'],
    })).toBe('iframe');
  });

  it('component downgrades to iframe when ui:code not granted', () => {
    expect(effectiveMode({
      frontend: { mode: 'component' }, signed: true, granted_permissions: [],
    })).toBe('iframe');
  });
});

describe('loadComponentPlugin — component-mode PoC', () => {
  function freshHost() {
    // isolate from the global singleton so tests don't leak into each other
    if (typeof window !== 'undefined') delete window.__AW_PLUGIN_HOST__;
    return installPluginHost({ registry: createSlotRegistry() });
  }

  const app = {
    slug: 'demo',
    signed: true,
    granted_permissions: ['ui:code', 'ui:slots:core.toolbar'],
    frontend: { mode: 'component', bundle_url: '/api/apps/demo/ui/plugin-abc.js' },
  };

  it('imports the bundle, calls register(host), and mounts into a granted slot', async () => {
    const host = freshHost();
    // Fake ESM module: its register() mounts a toolbar button + an own-slot item.
    const fakeModule = {
      register(h) {
        h.registerSlot('core.toolbar', () => 'quick-add', { id: 'demo:toolbar' });
        h.registerSlot('demo.sidebar', () => 'own', { id: 'demo:own' }); // own slot always allowed
        h.onDispose(() => { fakeModule._disposed = true; });
      },
    };
    const dispose = await loadComponentPlugin(app, host, { importer: async () => fakeModule });

    expect(host.registry.getSlot('core.toolbar').map((e) => e.id)).toEqual(['demo:toolbar']);
    expect(host.registry.getSlot('demo.sidebar')).toHaveLength(1);

    dispose();
    expect(host.registry.size()).toBe(0); // dispose empties every slot the app filled
    expect(fakeModule._disposed).toBe(true);
  });

  it('accepts contribution rows that identify the app as app instead of slug', async () => {
    const host = freshHost();
    let scoped;
    const mod = { register(h) { scoped = h; } };
    await loadComponentPlugin({ ...app, slug: undefined, app: 'demo' }, host, {
      importer: async () => mod,
    });
    expect(scoped.slug).toBe('demo');
    expect(scoped.app.apiUrl('/status')).toBe('/api/apps/demo/status');
  });

  it('an ungranted slot is skipped (no-op), not mounted', async () => {
    const host = freshHost();
    const mod = { register(h) { h.registerSlot('core.nav', () => 'x', { id: 'demo:nav' }); } };
    await loadComponentPlugin(app, host, { importer: async () => mod });
    // core.nav was NOT in the app's ui:slots grants → skipped
    expect(host.registry.getSlot('core.nav')).toEqual([]);
  });

  it('refuses to load when the effective mode is not component', async () => {
    const host = freshHost();
    const untrusted = { ...app, signed: false };
    await expect(loadComponentPlugin(untrusted, host, { importer: async () => ({ register() {} }) }))
      .rejects.toThrow(/component load refused/);
  });

  it('throws when the bundle exports no register function', async () => {
    const host = freshHost();
    await expect(loadComponentPlugin(app, host, { importer: async () => ({}) }))
      .rejects.toThrow(/no register/);
  });
});

describe('registerWindowActions — an app\'s buttons in the host title bar', () => {
  function freshHost() {
    if (typeof window !== 'undefined') delete window.__AW_PLUGIN_HOST__;
    return installPluginHost({ registry: createSlotRegistry() });
  }

  const app = {
    slug: 'whiteboard',
    signed: true,
    granted_permissions: ['ui:code'],
    frontend: { mode: 'component', bundle_url: '/api/apps/whiteboard/ui/plugin.js' },
  };

  it('lets an app fill its OWN window title bar with no extra ui:slots grant', async () => {
    const host = freshHost();
    const mod = {
      register(h) {
        h.registerWindowActions('whiteboard.main', () => 'buttons', { id: 'wb:actions' });
      },
    };
    await loadComponentPlugin(app, host, { importer: async () => mod });

    expect(host.registry.getSlot('core.window.titlebar:whiteboard.main').map((e) => e.id))
      .toEqual(['wb:actions']);
  });

  it('blocks an app from injecting buttons into ANOTHER app\'s window chrome', async () => {
    const host = freshHost();
    const mod = {
      register(h) {
        h.registerWindowActions('tasks.main', () => 'hijack', { id: 'wb:hijack' });
      },
    };
    await loadComponentPlugin(app, host, { importer: async () => mod });

    expect(host.registry.getSlot('core.window.titlebar:tasks.main')).toHaveLength(0);
  });

  it('keeps title-bar actions separate from the window body', async () => {
    const host = freshHost();
    const mod = {
      register(h) {
        h.registerWindow('whiteboard.main', () => 'body', { id: 'wb:body' });
        h.registerWindowActions('whiteboard.main', () => 'actions', { id: 'wb:actions' });
      },
    };
    await loadComponentPlugin(app, host, { importer: async () => mod });

    expect(host.registry.getSlot('core.window.body:whiteboard.main').map((e) => e.id))
      .toEqual(['wb:body']);
    expect(host.registry.getSlot('core.window.titlebar:whiteboard.main').map((e) => e.id))
      .toEqual(['wb:actions']);
  });

  it('drops both on dispose, leaving no orphan buttons in the chrome', async () => {
    const host = freshHost();
    const mod = {
      register(h) {
        h.registerWindow('whiteboard.main', () => 'body', { id: 'wb:body' });
        h.registerWindowActions('whiteboard.main', () => 'actions', { id: 'wb:actions' });
      },
    };
    const dispose = await loadComponentPlugin(app, host, { importer: async () => mod });
    dispose();

    expect(host.registry.size()).toBe(0);
  });
});
