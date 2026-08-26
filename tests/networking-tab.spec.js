// Real-browser proof of Settings NEW › General › Networking.
//
// The screen is behind the auth gate and its data comes from aw-backend, which
// this dev box has no browser session for — so the API is stubbed at the
// network layer with the REAL payload captured on 2026-08-25 from
// `aw-workspace-cli remote-hosts hosts` (the same route the tab calls). The
// React tree, the CSS and the layout are the real ones.
//
// Three things this has to show:
//   1. the host list, duplicate hostnames and offline links included
//   2. a written ineligibility reason on a host that does not pass
//   3. real mesh state on the hosts that reported — address and direct/relay —
//      and the honest "no agent data" on the ones that did not
// Plus a narrow viewport, because this screen gets read on a phone.
//
// NOTE: this file cannot close a card about the mesh. It stubs the API, so
// both API planes render byte-identical here — which is exactly how the
// wrong-plane bug (bf45ae7) shipped green past it. Real-screen verification is
// separate and mandatory; src/__tests__/networkingApi.originPlane.test.js is
// the unit-level guard that particular bug earned.
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

// Mesh state as aw-backend's `mesh_status` returns it, carrying the real
// readings measured 2026-08-25. The asymmetry is the interesting part and it
// is not a mistake: aw-mac -> aw-baremetal is DIRECT, while aw-baremetal ->
// aw-mac and everything -> aw-surface-wsl go through DERP(mad), because the
// Surface is WSL2 behind a second layer of NAT. Each row shows the reading
// somebody ELSE took of that host.
//
// Only CONNECTED hosts appear as reported. The five offline links reported
// nothing and carry `reported: false` with a written reason — which is the
// honest-unknown this screen exists to keep, and is asserted below.
const MESH = {
  control_plane_url: 'https://headscale.aw.tekflox.com',
  nodes: {
    '2d5d56ef224359c0': {
      reported: true, up: true, mesh_ip: '100.64.0.1', node_name: 'aw-baremetal',
      path: 'direct', via: '65.109.66.88:41641', exit_node: null, offers_exit: true,
    },
    '824decc7e0610089': {
      reported: true, up: true, mesh_ip: '100.64.0.3', node_name: 'aw-mac',
      path: 'relay', via: 'DERP(mad)', exit_node: null, offers_exit: false,
    },
    caf475b7032ee441: {
      reported: true, up: true, mesh_ip: '100.64.0.2', node_name: 'aw-surface-wsl',
      path: 'relay', via: 'DERP(mad)', exit_node: null, offers_exit: false,
    },
    // Answered, and said it has no tailscale — a report, not an absence.
    c76c606b0a2a5a8b: {
      reported: true, up: false,
      reason: 'the tailscale CLI is not installed on this host',
    },
    // Not on the mesh AND carrying its own verdict about why it could not
    // be: the two answers arrive together, and the second is what the row
    // used to render as "unconfirmed — not reported by any API yet".
    '11e8bd4157845a24': {
      reported: true, up: false,
      reason: 'the tailscale CLI is not installed on this host',
      eligibility: {
        can_enroll: false,
        enroll_refusal: '/run/systemd/system does not exist, so systemd is not managing '
          + 'this host and this module has no other way to keep tailscaled running '
          + 'across reboots.',
        can_advertise_exit: false,
        exit_refusal: 'this host cannot join the mesh at all: /run/systemd/system does not exist.',
        installer: '',
      },
    },
    ...Object.fromEntries(
      ['6bb0d0fbf5b22492', '8435edb900436230', '70cd8a5a3389c542', '739ff3c351dcdd02', '5d46be8ba50b6acb']
        .map((id) => [id, {
          reported: false,
          reason: 'this host is not connected to the control plane, so it could not be asked',
        }]),
    ),
  },
};

// The other unknown, and the one that took a live run to get right: a host
// that IS connected but runs an agent predating the verb. Its reason has to
// name an action.
//
// It rides on the WINDOWS link, and not on '11e8bd4157845a24' as it first did:
// that host is the one carrying the eligibility verdict above, and this object
// replaces a node rather than merging into it, so putting both on the same id
// silently dropped the eligibility block and the assertion that reads it.
// Windows is also the honest place for it — the Surface link runs the lean
// v0.1.35 agent, below the v0.1.51 that first reported mesh state. Nothing is
// lost by shadowing its MESH entry: '11e8bd4157845a24' carries the same
// "answered, and said it has no tailscale" shape.
const MESH_WITH_OLD_AGENT = {
  ...MESH,
  nodes: {
    ...MESH.nodes,
    c76c606b0a2a5a8b: {
      reported: false,
      reason: "this host's agent is too old to report mesh state — update aw-remote-host (v0.1.51 or later)",
    },
  },
};

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
  await page.route(onPath((p) => /^\/api\/workspaces\/[^/]+\/mesh-status$/.test(p)), (route) => route.fulfill(json(MESH_WITH_OLD_AGENT)));
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
    //    ...and where the host itself answered, ITS sentence, not ours.
    await expect(page.getByText(/\/run\/systemd\/system does not exist/)).toBeVisible();

    // 3. Real mesh state: the address each host reported, and the path
    //    somebody else measured to it.
    await expect(page.getByText(/Tailscale state unavailable/)).toHaveCount(0);
    await expect(page.getByText('100.64.0.1')).toBeVisible();
    // `exact` because the "direct vs relay" section heading below the list
    // contains the word too — the pill is the whole string, the heading is not.
    await expect(page.getByText('direct', { exact: true })).toBeVisible();
    await expect(page.getByText('via DERP(mad)').first()).toBeVisible();
    // The control plane comes from the API, so the placeholder is gone.
    const body = await page.locator('body').innerText();
    expect(body).toContain('https://headscale.aw.tekflox.com');
    expect(body).not.toContain('<tenant-control-plane>');

    // 4. The honest unknown, on the rows that reported nothing. Asserted per
    //    row, not per page: other rows legitimately show real 100.64.x.x now,
    //    so "no mesh IP anywhere" would no longer say anything.
    await page.getByRole('button', { name: /Offline links \(5\)/ }).click();
    //    Pinned to one offline link BY ID, not by `.first()` "no agent data":
    //    the connected-but-out-of-date host below shows that same pill for a
    //    different reason, and picking the first match lands on its row instead.
    const silent = page.locator('div.py-3').filter({ hasText: '5d46be8ba50b6acb' });
    await expect(silent).toContainText('no agent data');
    await expect(silent).toContainText('could not be asked');
    expect(await silent.innerText()).not.toMatch(/100\.\d+\.\d+\.\d+/);
    expect(await silent.innerText()).not.toMatch(/mesh offline|disconnected/i);

    //    ...and the other unknown: connected, but running an agent that
    //    predates the verb. Its reason names an action rather than quoting an
    //    error — that wording only got fixed because a live run showed it.
    await expect(page.getByText(/update aw-remote-host \(v0\.1\.51 or later\)/)).toBeVisible();

    // One Join mesh button per row — offline links are expanded by now, so
    // that is all ten of them. Every one is DISABLED on this payload, and for
    // a different reason each: two are already on the mesh, five links are
    // offline, one reported it cannot enrol, and two never answered. Nothing
    // says "not built yet" any more — the button is real, it is simply refused
    // on every host in this fixture, and each refusal is written on its row.
    const buttons = page.getByRole('button', { name: 'Join mesh' });
    await expect(buttons).toHaveCount(HOSTS.length);
    for (let i = 0; i < HOSTS.length; i += 1) await expect(buttons.nth(i)).toBeDisabled();
    expect(await page.locator('body').innerText()).not.toContain('not built yet');

    // And the instructions no longer tell anyone to type a key they cannot
    // know. Nothing is minted by opening the screen: the join command only
    // exists once someone asks for it.
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('--authkey=<key>');
    expect(text).not.toContain('<name>');
    await expect(page.getByRole('button', { name: 'Generate join command' })).toBeVisible();

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
    await expect(page.getByText('100.64.0.1')).toBeVisible();

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
