// Real-browser proof of Settings NEW › General › Networking.
//
// The screen is behind the auth gate and its data comes from aw-backend, which
// this dev box has no browser session for — so the API is stubbed at the
// network layer with the REAL payload captured on 2026-08-25 from
// `aw-workspace-cli remote-hosts hosts` (the same route the tab calls). The
// React tree, the CSS and the layout are the real ones.
//
// Three things this has to show, and they are the three the card called out:
//   1. the host list, duplicate hostnames and offline links included
//   2. a written ineligibility reason on a host that does not pass
//   3. the honest "no agent data" for the tailscale state
// Plus a narrow viewport, because this screen gets read on a phone.
import { test, expect } from '@playwright/test';

const HOSTS = [
  { id: '11e8bd4157845a24', workspace_slug: 'aw', hostname: 'b614f41828c8', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 12, connected: true },
  { id: 'c76c606b0a2a5a8b', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'windows', arch: 'amd64', last_seen_at: Date.now() / 1000 - 18, connected: true },
  { id: 'caf475b7032ee441', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 24, connected: true },
  { id: '2d5d56ef224359c0', workspace_slug: 'bare-metal-privileged', hostname: 'Ubuntu-resolute-latest-amd64-base.zst', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 26, connected: true },
  { id: '824decc7e0610089', workspace_slug: 'fredericowu', hostname: 'Mac.Home', os: 'darwin', arch: 'arm64', last_seen_at: Date.now() / 1000 - 32, connected: true },
  { id: '6bb0d0fbf5b22492', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 90000, connected: false },
  { id: '8435edb900436230', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 91000, connected: false },
  { id: '70cd8a5a3389c542', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 92000, connected: false },
  { id: '739ff3c351dcdd02', workspace_slug: 'bare-metal', hostname: 'Ubuntu-resolute-latest-amd64-base.zst', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 93000, connected: false },
  { id: '5d46be8ba50b6acb', workspace_slug: 'aw', hostname: '82ecce0392fe', os: 'linux', arch: 'amd64', last_seen_at: Date.now() / 1000 - 94000, connected: false },
];

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Matched on the PATHNAME, not with a `**/api/**` glob: this repo has a
// `src/api/` directory, so the glob also swallows Vite's own module requests
// for `/src/api/*.js` and the app never boots.
const onPath = (pred) => (url) => pred(url.pathname);

async function stubApi(page) {
  // The catch-all is registered first — Playwright matches the most recently
  // registered route, so the specific stubs below still win.
  await page.route(onPath((p) => p.startsWith('/api/')), (route) => route.fulfill(json({})));
  await page.route(onPath((p) => p === '/api/auth/status'), (route) => route.fulfill(json({ authenticated: true, mode: 'identity' })));
  await page.route(onPath((p) => p === '/api/apps'), (route) => route.fulfill(json([])));
  // Settings NEW opens on Users; UsersTab does `setUsers(await res.json())` with
  // no array guard, so an object here takes the whole panel down before
  // Networking is ever clicked.
  await page.route(onPath((p) => p === '/api/guest-users'), (route) => route.fulfill(json([])));
  await page.route(onPath((p) => p === '/api/identity/me'), (route) => route.fulfill(json({
    email: 'fredericowu@gmail.com',
    memberships: [{ workspace: 'aw', role: 'owner' }],
  })));
  await page.route(onPath((p) => /^\/api\/workspaces\/[^/]+\/remote-hosts$/.test(p)), (route) => route.fulfill(json({
    count: HOSTS.length, hosts: HOSTS,
  })));
}

async function openNetworking(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Open Settings NEW' }).click();
  await page.getByRole('button', { name: 'Networking' }).click();
  await expect(page.getByRole('heading', { name: 'Networking' })).toBeVisible();
}

test.describe('Settings NEW › General › Networking', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('lists the hosts, names the ineligibility reason, and is honest about the unknown', async ({ page }) => {
    await openNetworking(page);

    // 1. The list. Both Surface links are shown as separate rows.
    await expect(page.getByText('Mac.Home')).toBeVisible();
    await expect(page.getByText('DESKTOP-DRMKFBT')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Offline links \(5\)/ })).toBeVisible();

    // 2. The reason, as visible text on the page — not only in a tooltip.
    await expect(page.getByText(/Not Linux \(windows\)/)).toBeVisible();
    await expect(page.getByText(/macOS — automatic bootstrap is Linux-only/)).toBeVisible();

    // 3. The honest unknown, and nothing invented behind it.
    await expect(page.getByText(/Tailscale state unavailable/)).toBeVisible();
    await expect(page.getByText('no agent data').first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/100\.\d+\.\d+\.\d+/);
    expect(body).not.toContain('headscale.aw.tekflox.com');
    expect(body).toContain('<tenant-control-plane>');

    // Bootstrap stays a placeholder for every host.
    const buttons = page.getByRole('button', { name: 'Join mesh' });
    await expect(buttons).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) await expect(buttons.nth(i)).toBeDisabled();

    const win = page.locator('[data-window-key="panel:settings-new"]');
    await win.screenshot({ path: 'test-results/networking-wide.png' });

    // Second frame, scrolled to the host list: the ineligibility reasons are
    // below the fold at this window height, and they are the point of the card.
    await page.getByText('Mac.Home').scrollIntoViewIfNeeded();
    await win.screenshot({ path: 'test-results/networking-hosts.png' });
  });

  // 769px, not 390: at <=768 App.jsx swaps the whole shell for MobileApp, so
  // this is the narrowest width the DESKTOP shell ever renders — one pixel above
  // the switch, where the sidebar layout still has to hold up.
  //
  // The phone side is no longer a gap: SettingsPanelNew went responsive and
  // MobileApp mounts it, covered at a real 390px in mobile-settings-new.spec.js.
  // This case stays because the two layouts are different code paths and the
  // narrow end of the wide one is still worth pinning.
  test('reads at the narrowest width the desktop shell renders', async ({ page }) => {
    await page.setViewportSize({ width: 769, height: 900 });
    await openNetworking(page);

    await expect(page.getByText(/Not Linux \(windows\)/)).toBeVisible();
    await expect(page.getByText(/Tailscale state unavailable/)).toBeVisible();

    // The panel itself must not force a horizontal scroll. Command blocks are
    // allowed to scroll on their own (overflow-x-auto) — that is deliberate:
    // wrapping a shell command is worse than scrolling it.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-window-key="panel:settings-new"]');
      return el ? el.scrollWidth - el.clientWidth : -1;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    const win = page.locator('[data-window-key="panel:settings-new"]');
    await win.screenshot({ path: 'test-results/networking-narrow.png' });
    await page.getByText('Mac.Home').scrollIntoViewIfNeeded();
    await win.screenshot({ path: 'test-results/networking-narrow-hosts.png' });
  });

  test('a failing host list is reported, not rendered as empty', async ({ page }) => {
    await page.route(onPath((p) => /^\/api\/workspaces\/[^/]+\/remote-hosts$/.test(p)), (route) => route.fulfill({
      status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not Found' }),
    }));
    await openNetworking(page);

    await expect(page.getByText(/Could not list the hosts/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.locator('[data-window-key="panel:settings-new"]').screenshot({ path: 'test-results/networking-error.png' });
  });
});
