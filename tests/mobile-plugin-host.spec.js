// Real-browser proof that the MOBILE shell boots the decoupled-apps plugin
// runtime (2026-08-19 fix).
//
// The bug: `App()` returns either <MobileApp/> or <AuthenticatedApp/>, and the
// runtime bootstrap (installPluginHost + fetch contributions + wireContributions)
// lived in an effect inside AuthenticatedApp only. On `#mobile` it therefore
// never ran — the reported symptom was ZERO plugin bundle requests in the
// network log and a permanently empty `.mobile-presentation-view`, because
// `windowBodySlot('presentations.viewer')` had nothing registered in it.
//
// What this proves that the jsdom unit tests can't: in a real Chromium, on the
// real `#mobile` route, the app's bundle URL is actually REQUESTED over the
// network and its `register(host)` actually fills the window-body slot the
// mobile shell renders.
import { test, expect } from '@playwright/test';

const BUNDLE_PATH = '/api/apps/presentations/ui/plugin-test.js';

// A real ES module, served over HTTP and imported by the production loader
// (loadPlugin.js fetches the text and imports it as a blob URL).
const BUNDLE_SRC = `
export function register(host) {
  host.registerWindow('presentations.viewer', () => host.h('div', {
    'data-testid': 'presentations-body',
  }, 'presentation body rendered'));
  host.registerWindowActions?.('presentations.viewer', () => host.h('button', {
    'data-testid': 'presentations-action',
  }, 'Share'));
}
export default register;
`;

const CONTRIBUTIONS = {
  nav: [],
  windows: [
    { id: 'presentations.viewer', app: 'presentations', title: 'Presentation', body: { type: 'component' } },
  ],
  frontend: [
    {
      app: 'presentations',
      slug: 'presentations',
      signed: true,
      // `ui:code` + signed is what keeps effectiveMode() at 'component' instead
      // of downgrading to iframe (loadPlugin.js trust gate).
      granted_permissions: ['ui:code'],
      frontend: { mode: 'component', bundle_url: BUNDLE_PATH },
    },
  ],
};

async function stubWorkspace(page, bundleRequests) {
  // Registered FIRST so it loses: Playwright matches routes in REVERSE
  // registration order, so the specific handlers below take precedence. This
  // one just keeps every other boot poll off the real API behind the dev proxy.
  //
  // Anchored at the origin root, NOT `**/api/**` — that glob also matches the
  // dev server's own module URLs (`/src/api/marketplaceApi.js`), serving them
  // as JSON, which breaks the module graph and the SPA never boots at all.
  await page.route(/^https?:\/\/[^/]+\/api\//, (route) => route.fulfill({ json: [] }));

  await page.route('**/api/auth/status', (route) =>
    route.fulfill({ json: { authenticated: true, mode: 'password' } }));
  await page.route('**/api/apps/-/contributions', (route) =>
    route.fulfill({ json: CONTRIBUTIONS }));
  await page.route(`**${BUNDLE_PATH}`, (route) => {
    bundleRequests.push(route.request().url());
    return route.fulfill({ body: BUNDLE_SRC, contentType: 'text/javascript' });
  });
}

test.describe('mobile shell — decoupled-apps plugin runtime', () => {
  test('fetches app bundles and fills the window-body slot on #mobile', async ({ page }) => {
    const bundleRequests = [];
    await stubWorkspace(page, bundleRequests);

    await page.setViewportSize({ width: 390, height: 844 }); // iPhone-ish
    await page.goto('/#mobile');

    // 1. The bundle is actually requested. This is the exact thing the live
    //    repro found missing ("zero .mjs plugin bundle requests").
    await expect.poll(() => bundleRequests.length, { timeout: 15000 }).toBeGreaterThan(0);

    // 2. register(host) ran and filled the slot the mobile shell renders.
    const slotIds = await page.evaluate(() =>
      window.__AW_PLUGIN_HOST__.registry
        .getSlot('core.window.body:presentations.viewer')
        .map((e) => e.id));
    expect(slotIds.length).toBe(1);

    // 3. The title-bar action slot is filled too — the related gap the
    //    presentations app had to work around with its own floating action bar.
    const titlebarIds = await page.evaluate(() =>
      window.__AW_PLUGIN_HOST__.registry
        .getSlot('core.window.titlebar:presentations.viewer')
        .map((e) => e.id));
    expect(titlebarIds.length).toBe(1);
  });

  test('the mobile presentation view renders the app body, not an empty div', async ({ page }) => {
    const bundleRequests = [];
    await stubWorkspace(page, bundleRequests);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#mobile');
    await expect.poll(() => bundleRequests.length, { timeout: 15000 }).toBeGreaterThan(0);

    // MobileApp only mounts `.mobile-presentation-view` once its own
    // presentations WebSocket pushes a presentation, which this stub can't
    // drive. What actually broke was one step earlier and is what's asserted
    // here: the registered contribution now RENDERS a real node, so the
    // AppSlot inside `.mobile-presentation-view` has something to paint
    // instead of resolving to nothing.
    const rendered = await page.evaluate(() => {
      const host = window.__AW_PLUGIN_HOST__;
      const entries = host.registry.getSlot('core.window.body:presentations.viewer');
      if (!entries.length) return null;
      const node = entries[0].render({ windowKey: 'presentation:1', instanceId: '1' });
      return { type: typeof node, testid: node?.props?.['data-testid'], text: node?.props?.children };
    });

    expect(rendered).not.toBeNull();
    expect(rendered.testid).toBe('presentations-body');
    expect(rendered.text).toBe('presentation body rendered');
  });
});
