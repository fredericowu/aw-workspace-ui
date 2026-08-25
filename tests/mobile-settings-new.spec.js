// Real-browser proof that Settings NEW is reachable AND usable from the phone
// shell, at a real iPhone viewport (390px).
//
// The bug: below 768px App.jsx swaps the whole shell for MobileApp, and
// MobileApp mounted the LEGACY SettingsPanel. Settings NEW — every section in
// it, including Networking (d01257c) — did not exist on the phone at all. The
// networking-tab spec could only test down to 769px, one pixel above the shell
// switch, and said so in a comment.
//
// What this proves that a jsdom test can't: in real Chromium, at 390px, on the
// real #mobile route, the section is reachable by touch navigation and the
// panel does not force horizontal panning — which is the acceptance bar the
// card set ("não basta abrir: tem que dar pra usar sem pan horizontal").
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
  // Settings NEW's Users section does `setUsers(await res.json())` with no array
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

async function openMobileSettingsNew(page) {
  await page.setViewportSize(IPHONE);
  await page.goto('/#mobile');
  // The Workspace group is expanded by default on the mobile dashboard.
  await page.getByText('Settings NEW', { exact: true }).click();
}

test.describe('Settings NEW on the mobile shell @ 390px', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('is reachable from the phone dashboard and opens on the section list', async ({ page }) => {
    await openMobileSettingsNew(page);

    // The sheet is Settings NEW, not the legacy tab strip. The legacy panel's
    // giveaway is a "TCP Proxy" tab rendered as a top strip; Settings NEW shows
    // grouped nav with a General header and a "soon" marker on unmigrated ones.
    await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Networking/ })).toBeVisible();

    // List-then-detail: no section content until one is picked, so the whole
    // 390px width belongs to the list.
    await expect(page.getByRole('heading', { name: 'Networking' })).toHaveCount(0);

    await page.screenshot({ path: 'test-results/mobile-settings-new-list.png' });
  });

  test('navigates to General > Networking and renders it without horizontal pan', async ({ page }) => {
    await openMobileSettingsNew(page);
    await page.getByRole('button', { name: /Networking/ }).click();

    // The real section rendered — same assertions the desktop spec makes.
    await expect(page.getByRole('heading', { name: 'Networking' })).toBeVisible();
    await expect(page.getByText('Mac.Home')).toBeVisible();
    await expect(page.getByText(/Não é Linux \(windows\)/)).toBeVisible();

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
    await openMobileSettingsNew(page);
    await page.getByRole('button', { name: /Networking/ }).click();
    await expect(page.getByRole('heading', { name: 'Networking' })).toBeVisible();

    await page.getByRole('button', { name: /Back to Settings — Networking/ }).click();

    await expect(page.getByRole('heading', { name: 'Networking' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
  });

  test('the legacy Settings panel is still reachable — nothing was taken away', async ({ page }) => {
    // Settings NEW leaves 7 sections as `ready: false` placeholders (AW Config,
    // TCP Proxy, Cookies, Feed Subscriber, Backup, Skills, MCP Servers) that
    // only work in the legacy panel. Swapping instead of adding would have
    // removed them from the phone.
    await page.setViewportSize(IPHONE);
    await page.goto('/#mobile');
    await page.getByText('Settings', { exact: true }).click();

    // The legacy tab strip, not the grouped sidebar.
    await expect(page.getByRole('button', { name: 'TCP Proxy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MCP Servers' })).toBeVisible();
  });
});
