import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The local (LAN fast-path) origin used to be CONSTRUCTED from the URL slug
// (`local.<slug>.workspace.<apex>`), which made it enumerable — any guessed
// slug resolved to a real workspace's LAN IP. dns_publication.py's "lan"
// kind replaces that with an opaque, non-guessable per-workspace name, so
// the SPA can no longer build the local origin itself; it has to ask the
// control plane for it (GET .../dns-publications) the same way it already
// asks for everything else identity-gated. These tests assert that
// discovery, not the construction it replaces.
//
// dns-publications is mounted on the CENTRAL aw-backend host (api.<apex>)
// only — the per-workspace BYOD tunnel host (api.<slug>.workspace.<apex>)
// never had this route and 404s. The discovery fetch must go through
// centralApiUrl(), not the tunnel origin.

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

describe('apiBase — local origin is discovered, never derived from the slug', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    restoreLocation();
    vi.unstubAllGlobals();
  });

  it('fetchLocalOrigin reads the enabled lan row name from dns-publications, on the workspace tunnel API origin', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        publications: [
          { kind: 'wan', enabled: true, name: 'fredericowu.workspace.ddns.tekflox.com' },
          { kind: 'lan', enabled: true, name: 'qz3f8vN0pXyZ1a2b3c4d5e6f7g.local.workspace.aw.tekflox.com' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin, isLanFastPath, probeLanFastPath } = await import('../apiBase');
    await fetchLocalOrigin();

    // The discovery call itself: absolute, on the CENTRAL api host
    // (api.<apex> — no slug prefix), never the per-workspace tunnel host
    // (api.<slug>.workspace.<apex>, which never mounts this route and 404s)
    // and never relative (which would resolve against the SPA's own static
    // host).
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.aw.tekflox.com/api/workspaces/fredericowu/dns-publications',
      expect.objectContaining({ credentials: 'include' }),
    );

    // The discovered local origin is now reachable via the ordinary probe —
    // proving BASES.local was actually populated by the fetch above, not
    // left for probeLanFastPath to construct itself.
    fetchMock.mockResolvedValueOnce({ ok: true });
    const active = await probeLanFastPath();

    expect(active).toBe(true);
    expect(isLanFastPath()).toBe(true);
    const probedUrl = fetchMock.mock.calls[1][0];
    expect(probedUrl).toBe(
      'https://qz3f8vN0pXyZ1a2b3c4d5e6f7g.local.workspace.aw.tekflox.com:8443/api/health',
    );
  });

  it('never asks the per-workspace tunnel host — dns-publications is central-plane only and 404s there', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        publications: [{ kind: 'lan', enabled: true, name: 'abc123.local.workspace.aw.tekflox.com' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin } = await import('../apiBase');
    await fetchLocalOrigin();

    const requestedUrl = fetchMock.mock.calls[0][0];
    expect(requestedUrl).not.toBe(
      'https://api.fredericowu.workspace.aw.tekflox.com/api/workspaces/fredericowu/dns-publications',
    );
    expect(requestedUrl.startsWith('https://api.fredericowu.workspace.')).toBe(false);
  });

  it('never falls back to constructing local.<slug>.workspace... — the opaque name only ever comes from the API response', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        publications: [{ kind: 'lan', enabled: true, name: 'abc123.local.workspace.aw.tekflox.com' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin, probeLanFastPath } = await import('../apiBase');
    await fetchLocalOrigin();
    fetchMock.mockResolvedValueOnce({ ok: true });
    await probeLanFastPath();

    const probedUrl = fetchMock.mock.calls[1][0];
    expect(probedUrl).not.toContain('local.fredericowu.workspace');
    expect(probedUrl).toContain('abc123.local.workspace.aw.tekflox.com');
  });

  it('stays without a local origin when there is no enabled lan publication yet', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publications: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin, probeLanFastPath, isLanFastPath } = await import('../apiBase');
    await fetchLocalOrigin();
    const active = await probeLanFastPath();

    expect(active).toBe(false);
    expect(isLanFastPath()).toBe(false);
    // No second (health-probe) call — probeLanFastPath is a documented
    // no-op without a local origin to probe.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not enable the local origin for a "lan" row that exists but is not enabled', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        publications: [{ kind: 'lan', enabled: false, name: 'abc123.local.workspace.aw.tekflox.com' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin, probeLanFastPath } = await import('../apiBase');
    await fetchLocalOrigin();
    const active = await probeLanFastPath();

    expect(active).toBe(false);
  });

  it('a network failure while discovering the local origin is swallowed, not thrown', async () => {
    setLocation('fredericowu.workspace.aw.tekflox.com');
    const fetchMock = vi.fn().mockRejectedValue(new Error('NetworkError'));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin, probeLanFastPath } = await import('../apiBase');
    await expect(fetchLocalOrigin()).resolves.toBeUndefined();
    expect(await probeLanFastPath()).toBe(false);
  });

  it('is a no-op on a non-workspace host (no slug to scope the discovery call to)', async () => {
    // Default jsdom host — not a `<slug>.workspace.<apex>` host.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLocalOrigin } = await import('../apiBase');
    await fetchLocalOrigin();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
