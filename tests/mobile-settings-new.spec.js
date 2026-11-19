// Browser coverage for the Settings entry points and legacy fragments.
import { test, expect } from '@playwright/test';

const HOSTS = [
  { id: '11e8bd4157845a24', workspace_slug: 'aw', hostname: 'b614f41828c8', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 12, connected: true },
  { id: 'c76c606b0a2a5a8b', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'windows', arch: 'amd64', last_seen_at: Date.now() / 1000 - 18, connected: true },
  { id: '824decc7e0610089', workspace_slug: 'fredericowu', hostname: 'Mac.Home', os: 'darwin', arch: 'arm64', last_seen_at: Date.now() / 1000 - 32, connected: true },
];

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Matched on the PATHNAME, not with a `**/api/**` glob: this repo has a
// `src/api/` directory, so the glob also swallows Vite's own module requests
// for `/src/api/*.js` and the app never boots. (Same trap as networking-tab.spec.js.)
const onPath = (pred) => (url) => pred(url.pathname);

async function stubApi(page) {
  // Registered first so it loses — Playwright matches most-recently-registered.
  await page.route(onPath((p) => p.startsWith('/api/')), (route) => route.fulfill(json({})));
  await page.route(onPath((p) => p === '/api/auth/status'), (route) => route.fulfill(json({ authenticated: true, mode: 'identity' })));
  await page.route(onPath((p) => p === '/api/apps'), (route) => route.fulfill(json([])));
  await page.route(onPath((p) => p === '/api/apps/-/contributions'), (route) => route.fulfill(json({ nav: [], windows: [], frontend: [] })));
  // Settings' Users section does `setUsers(await res.json())` with no array
  // guard — an object here takes the panel down before Networking is clicked.
  await page.route(onPath((p) => p === '/api/guest-users'), (route) => route.fulfill(json([])));
  await page.route(onPath((p) => p === '/api/identity/me'), (route) => route.fulfill(json({
    email: 'fredericowu@gmail.com',
    memberships: [{ workspace: 'aw', role: 'owner' }],
  })));
  await page.route(onPath((p) => /^\/api\/workspaces\/[^/]+\/remote-hosts$/.test(p)), (route) => route.fulfill(json({
    count: HOSTS.length, hosts: HOSTS,
  })));
}

const IPHONE = { width: 390, height: 844 };

async function openMobileSettings(page) {
  await page.setViewportSize(IPHONE);
  await page.goto('/#mobile');
  // The Workspace group is expanded by default on the mobile dashboard.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test.describe('Settings on the mobile shell @ 390px', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('is reachable from the phone dashboard and opens on the section list', async ({ page }) => {
    await openMobileSettings(page);

    await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Networking/ })).toBeVisible();

    // List-then-detail: no section content until one is picked, so the whole
    // 390px width belongs to the list.
    await expect(page.getByRole('heading', { name: 'Networking' })).toHaveCount(0);

    await page.screenshot({ path: 'test-results/mobile-settings-new-list.png' });
  });

  test('navigates to General > Networking and renders it without horizontal pan', async ({ page }) => {
    await openMobileSettings(page);
    await page.getByRole('button', { name: /Networking/ }).click();

    // The real section rendered — same assertions the desktop spec makes.
    await expect(page.getByRole('heading', { name: 'Networking' })).toBeVisible();
    await expect(page.getByText('Mac.Home')).toBeVisible();
    await expect(page.getByText(/Not Linux \(windows\)/)).toBeVisible();

    // THE acceptance bar: the document must not scroll sideways at 390px.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);

    // No element may overflow the viewport either — a fixed-width sidebar
    // inside an overflow-hidden parent would be clipped, not scrolled, and so
    // would pass the document check above while still eating the screen.
    const widest = await page.evaluate(() => {
      let max = 0;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) max = Math.max(max, Math.ceil(r.right));
      }
      return max;
    });
    expect(widest).toBeLessThanOrEqual(IPHONE.width);

    await page.screenshot({ path: 'test-results/mobile-settings-new-networking.png' });
    await page.getByText('Mac.Home').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/mobile-settings-new-networking-hosts.png' });
  });

  test('the back row returns to the section list', async ({ page }) => {
    await openMobileSettings(page);
    await page.getByRole('button', { name: /Networking/ }).click();
    await expect(page.getByRole('heading', { name: 'Networking' })).toBeVisible();

    await page.getByRole('button', { name: /Back to Settings — Networking/ }).click();

    await expect(page.getByRole('heading', { name: 'Networking' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
  });

  test('has one Settings entry and keeps the former sections available', async ({ page }) => {
    await page.setViewportSize(IPHONE);
    await page.goto('/#mobile');
    await expect(page.getByRole('button', { name: /^Settings/ })).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    for (const name of ['AW', 'TCP Proxy', 'Workspace VPN', 'Local Network', 'Cookies',
      'Feed Subscriber', 'Backup', 'Skills', 'MCP Servers']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('consumes cold and repeated links, falls back for unknown tabs, and reloads cleanly', async ({ page }) => {
    await page.setViewportSize(IPHONE);
    await page.goto('/?settings-test=1#settings/backup');
    const backup = page.getByRole('heading', { name: 'Backup' });
    await expect(backup).toBeVisible();
    await expect(page).toHaveURL('/?settings-test=1');

    await page.getByRole('button', { name: /Back to Settings — Backup/ }).click();
    await page.evaluate(() => { location.hash = '#settings/backup'; });
    await expect(backup).toBeVisible();
    await expect(page).toHaveURL('/?settings-test=1');

    await page.evaluate(() => { location.hash = '#settings/constructor'; });
    await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
    await expect(backup).toHaveCount(0);
    await expect(page).toHaveURL('/?settings-test=1');
    await page.goBack();
    await expect(page).toHaveURL('/?settings-test=1');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search settings' })).toHaveCount(0);
  });
});

for (const layout of ['desktop', 'mobile']) {
  test(`opens the same Settings app configuration in forced ${layout}`, async ({ page }) => {
    await stubApi(page);
    await page.route(onPath((p) => p === '/api/apps'), (route) => route.fulfill(json([{
      slug: 'agents-platform-runners', name: 'Agents Platform Runners', version: '1',
      has_config: true, config: { workspace_slug: 'aw' },
      config_schema: { properties: { workspace_slug: { type: 'string', title: 'Workspace slug' } } },
    }])));
    await page.goto(`/#${layout}`);
    if (layout === 'desktop') {
      await page.getByRole('button', { name: 'Workspace menu' }).hover();
      await expect(page.getByRole('button', { name: /^Open Settings/ })).toHaveCount(1);
      await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    }
    await page.getByRole('button', { name: /Agents Platform Runners/ }).click();
    await expect(page.getByRole('heading', { name: 'Agents Platform Runners' })).toBeVisible();
    await expect(page.getByLabel('Workspace slug')).toHaveValue('aw');

    await page.evaluate(() => { location.hash = '#settings/backup'; });
    await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible();
    await expect(page).toHaveURL('/');
  });
}

test('restores a single Settings window from legacy desktop storage and accepts a cold link', async ({ page }) => {
  await stubApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('aw-open-windows', JSON.stringify(['panel:settings', 'panel:settings-new']));
    localStorage.setItem('aw-maximized-key', 'panel:settings');
  });
  await page.goto('/?settings-test=1#settings/backup');
  await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search settings' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(page).toHaveURL('/?settings-test=1');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aw-open-windows')))
    .toBe(JSON.stringify(['panel:settings-new']));
});
