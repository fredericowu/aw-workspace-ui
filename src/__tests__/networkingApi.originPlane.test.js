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
