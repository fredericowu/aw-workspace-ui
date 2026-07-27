// Real-browser proof of the F5 frontend plugin runtime (ADR Decision 3b).
//
// The full Apps view sits behind the auth gate (see app-window.spec.js), so
// this drives the runtime directly in a real Chromium context via the Vite dev
// server: it installs the host global, dynamic-import()s a component-mode bundle
// (a real `data:` ES module — exercising the actual native import() path, not a
// jsdom stub), mounts into a named slot through register(host), then disposes.
//
// What this proves in a browser that the jsdom unit tests can't: `window.
// __AW_PLUGIN_HOST__` is a real global, native dynamic import() of an ESM bundle
// works, register(host) mounts into the reactive slot registry, and dispose
// empties it — the component-mode PoC end to end.
import { test, expect } from '@playwright/test';

const HARNESS = `
import { installPluginHost } from '/src/apps/pluginHost.js';
import { loadComponentPlugin } from '/src/apps/loadPlugin.js';
import { createSlotRegistry } from '/src/apps/slotRegistry.js';
import { effectiveMode } from '/src/apps/loadPlugin.js';

window.__awRuntimeTest = (async () => {
  const host = installPluginHost({ registry: createSlotRegistry() });
  const app = {
    slug: 'demo', signed: true,
    granted_permissions: ['ui:code', 'ui:slots:core.toolbar'],
    frontend: { mode: 'component', bundle_url: '/api/apps/demo/ui/plugin-abc.js' },
  };
  // A REAL ES module fetched via native dynamic import().
  const src = 'export function register(h){ h.registerSlot("core.toolbar", () => "quick-add", { id: "demo:tb" }); }';
  const importer = () => import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(src));

  const untrusted = effectiveMode({ frontend: { mode: 'component' }, signed: false, granted_permissions: ['ui:code'] });
  const dispose = await loadComponentPlugin(app, host, { importer });
  const mounted = host.registry.getSlot('core.toolbar').map((e) => e.id);
  const hasGlobal = typeof window.__AW_PLUGIN_HOST__ === 'object';
  dispose();
  const afterDispose = host.registry.size();
  return { mounted, hasGlobal, afterDispose, untrusted };
})();
`;

test.describe('F5 frontend plugin runtime (component mode)', () => {
  test('installs host global, dynamic-imports a bundle, mounts a slot, disposes clean', async ({ page }) => {
    // Ensure the Vite dev origin is live, then run the harness as an inline
    // module script (its /src/* imports are served + transformed by Vite).
    await page.goto('/');
    await page.setContent(`<!doctype html><html><body><script type="module">${HARNESS}<\/script></body></html>`);

    const result = await page.waitForFunction(() => window.__awRuntimeTest, null, { timeout: 15000 })
      .then((h) => h.jsonValue());

    expect(result.hasGlobal).toBe(true);
    expect(result.mounted).toEqual(['demo:tb']);      // component-mode PoC mounted into the slot
    expect(result.afterDispose).toBe(0);              // dispose empties every slot the app filled
    expect(result.untrusted).toBe('iframe');          // trust gate downgrades an unsigned component app
  });
});
