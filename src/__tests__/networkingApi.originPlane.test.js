import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for bug:networking-tab-calls-wrong-api-plane — the
// Networking tab's identity/host-list calls went out as relative `/api/...`
// paths, which resolve against the PAGE origin. On a workspace SPA host
// (`<slug>.workspace.<apex>`) that page origin is the cloud static SPA, which
// serves neither `/api/identity/me` nor `/api/workspaces/*` — those are
// CENTRAL aw-backend routes (`api.<apex>`), a different host entirely. This
// asserts the request URL is resolved to that backend origin instead of
// being left relative, which is the exact thing a fixture-backed dev-server
// e2e can't catch (see the card body — both planes render byte-identical
// there).

const ORIGINAL_LOCATION = window.location;

function setLocation(hostname) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...ORIGINAL_LOCATION, hostname, protocol: 'https:' },
  });
}

function restoreLocation() {
  Object.defineProperty(window, 'location', { configurable: true, value: ORIGINAL_LOCATION });
}

describe('networkingApi — resolves the central aw-backend origin, not the page origin', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../auth', () => ({ apiFetch: vi.fn() }));
  });

  afterEach(() => {
    restoreLocation();
  });

  it('resolveAccountSlug calls the aw-backend origin on a workspace SPA host', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }),
    });
    const { resolveAccountSlug } = await import('../lib/networkingApi');

    const slug = await resolveAccountSlug();

    expect(slug).toBe('aw');
    expect(apiFetch).toHaveBeenCalledWith('https://api.aw.tekflox.com/api/identity/me');
  });

  it('fetchRemoteHosts sends BOTH the identity lookup and the host-list call to the backend origin', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockImplementation((url) => {
      if (url.endsWith('/api/identity/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0, hosts: [] }) });
    });
    const { fetchRemoteHosts } = await import('../lib/networkingApi');

    await fetchRemoteHosts();

    const urls = apiFetch.mock.calls.map(([url]) => url);
    // Fixing only the host-list call and leaving resolveAccountSlug relative
    // would still break the chain at the first hop — both must resolve.
    expect(urls).toEqual([
      'https://api.aw.tekflox.com/api/identity/me',
      'https://api.aw.tekflox.com/api/workspaces/aw/remote-hosts',
    ]);
    // Neither call is a bare page-relative path.
    urls.forEach((url) => expect(url.startsWith('/')).toBe(false));
  });

  it('fetchMeshStatus resolves to the backend origin too', async () => {
    // The mesh-status route is on the same CENTRAL plane as its neighbours.
    // Leaving it relative would 404 on the workspace SPA host and surface as
    // "no agent data" — the same bug wearing the honest-unknown's clothes,
    // which is exactly why it would go unnoticed.
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockImplementation((url) => {
      if (url.endsWith('/api/identity/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ control_plane_url: null, nodes: {} }),
      });
    });
    const { fetchMeshStatus } = await import('../lib/networkingApi');

    const result = await fetchMeshStatus();

    expect(result.available).toBe(true);
    const urls = apiFetch.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      'https://api.aw.tekflox.com/api/identity/me',
      'https://api.aw.tekflox.com/api/workspaces/aw/mesh-status',
    ]);
    urls.forEach((url) => expect(url.startsWith('/')).toBe(false));
  });

  it('fetchMeshStatus never rejects — a failure is data about the mesh', async () => {
    // NetworkingTab fetches this alongside the host list in one Promise.all,
    // so a throw here would blank the host table and report a mesh outage as
    // "could not list the hosts".
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockRejectedValue(new Error('NetworkError'));
    const { fetchMeshStatus } = await import('../lib/networkingApi');

    const result = await fetchMeshStatus('aw');

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/NetworkError/);
  });

  it('stays relative on a non-workspace host (single-tenant dashboard, dev, previews)', async () => {
    // Default jsdom host — not a `<slug>.workspace.<apex>` host, so
    // deriveBases() finds no apex and centralApiUrl is a no-op, matching the
    // existing same-origin behavior there.
    const { apiFetch } = await import('../auth');
    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }),
    });
    const { resolveAccountSlug } = await import('../lib/networkingApi');

    await resolveAccountSlug();

    expect(apiFetch).toHaveBeenCalledWith('/api/identity/me');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// currentWorkspaceSlug — networking:public-ip-banner-wrong-workspace-and-per-host-ip
//
// `resolveAccountSlug()` above answers "some workspace this login owns",
// picked by membership order — the OWNER membership if there is one, else
// whichever the API happens to list first. That is not the same question as
// "which workspace is this SCREEN showing", and the two diverge exactly when
// a login owns more than one workspace: the Public IP banner used to default
// to the first-owned one regardless of which workspace's Settings the user
// had open, and silently measured a different machine's egress.
// ─────────────────────────────────────────────────────────────────────────────
describe('currentWorkspaceSlug — the workspace on screen, not "some workspace this login owns"', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../auth', () => ({ apiFetch: vi.fn() }));
  });

  afterEach(() => {
    restoreLocation();
  });

  it('reads the slug off the URL and never touches identity/me, even when the login owns several workspaces', async () => {
    // Frederico owns several workspaces; `fredericowu` sorts first in his
    // memberships and would be resolveAccountSlug()'s answer. He is looking
    // at `aw` right now — the hostname is the only thing that can say so.
    setLocation('aw.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        memberships: [
          { workspace: 'fredericowu', role: 'owner' },
          { workspace: 'aw', role: 'owner' },
          { workspace: 'bare-metal-privileged', role: 'owner' },
          { workspace: 'surface', role: 'owner' },
        ],
      }),
    });
    const { currentWorkspaceSlug } = await import('../lib/networkingApi');

    const slug = await currentWorkspaceSlug();

    expect(slug).toBe('aw');
    // The whole point: this must not need to ask identity/me who owns what.
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('falls back to resolveAccountSlug() where there is no URL to read a slug from', async () => {
    // Default jsdom host — not a `<slug>.workspace.<apex>` host, so there is
    // no "workspace on screen" to derive; the closest available answer is
    // "some workspace this login owns".
    const { apiFetch } = await import('../auth');
    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }),
    });
    const { currentWorkspaceSlug } = await import('../lib/networkingApi');

    const slug = await currentWorkspaceSlug();

    expect(slug).toBe('aw');
    expect(apiFetch).toHaveBeenCalledWith('/api/identity/me');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchHostPublicIp — Part 2 of the same card: one measurement per remote
// host, not per workspace.
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchHostPublicIp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../auth', () => ({ apiFetch: vi.fn() }));
  });

  afterEach(() => {
    restoreLocation();
  });

  it('resolves to the backend origin, scoped by host id rather than by workspace', async () => {
    setLocation('aw.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ host_id: '2d5d56ef224359c0', ip: '65.109.66.88', via: null, error: null }),
    });
    const { fetchHostPublicIp } = await import('../lib/networkingApi');

    const result = await fetchHostPublicIp('aw', '2d5d56ef224359c0');

    expect(result).toEqual({ ip: '65.109.66.88', via: null, error: null });
    expect(apiFetch).toHaveBeenCalledWith(
      'https://api.aw.tekflox.com/api/workspaces/aw/remote-hosts/2d5d56ef224359c0/public-ip',
    );
  });

  it('never rejects — an unreachable host is a written reason, not a thrown error', async () => {
    setLocation('aw.workspace.aw.tekflox.com');
    const { apiFetch } = await import('../auth');
    apiFetch.mockRejectedValue(new Error('NetworkError'));
    const { fetchHostPublicIp } = await import('../lib/networkingApi');

    const result = await fetchHostPublicIp('aw', 'some-host-id');

    expect(result.ip).toBeNull();
    expect(result.error).toMatch(/NetworkError/);
  });
});
