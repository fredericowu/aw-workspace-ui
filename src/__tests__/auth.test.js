import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('Auth module', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock('../apiBase');
  });

  it('should export apiFetch', async () => {
    const { apiFetch } = await import('../auth');
    expect(typeof apiFetch).toBe('function');
  });

  it('apiFetch adds auth headers', async () => {
    localStorage.setItem('aw_api_key', 'test-key-123');
    const { apiFetch } = await import('../auth');

    await apiFetch('/api/test');

    expect(fetch).toHaveBeenCalled();
    const [url] = fetch.mock.calls[0];
    expect(url).toBe('/api/test');
  });

  it('apiFetch fires aw-auth-failed on a 401 from the framework API', async () => {
    fetch.mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) });
    const { apiFetch } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    await apiFetch('/api/tasks');

    expect(onFail).toHaveBeenCalledTimes(1);
    window.removeEventListener('aw-auth-failed', onFail);
  });

  it('apiFetch does NOT fire aw-auth-failed on a 401 from an app-proxied route', async () => {
    fetch.mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) });
    const { apiFetch } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    await apiFetch('/api/apps/mcp-gateway/admin/config');

    expect(onFail).not.toHaveBeenCalled();
    window.removeEventListener('aw-auth-failed', onFail);
  });

  it('logout uses legacy auth endpoint outside workspace hosts', async () => {
    vi.doMock('../apiBase', () => ({
      consoleLogoutUrl: () => null,
      identityLogoutUrl: () => null,
    }));
    const { logout } = await import('../auth');

    await logout();

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout uses central identity endpoint from workspace hosts', async () => {
    vi.doMock('../apiBase', () => ({
      consoleLogoutUrl: () => null,
      identityLogoutUrl: () => 'https://api.aw.tekflox.com/api/identity/logout',
    }));
    const { logout } = await import('../auth');

    await logout();

    expect(fetch).toHaveBeenCalledWith('https://api.aw.tekflox.com/api/identity/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout redirects workspace hosts to the console logout flow', async () => {
    vi.doMock('../apiBase', () => ({
      consoleLogoutUrl: () => 'https://console.aw.tekflox.com/logout',
      identityLogoutUrl: () => 'https://api.aw.tekflox.com/api/identity/logout',
    }));
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
    const { logout } = await import('../auth');

    await logout();

    expect(assign).toHaveBeenCalledWith('https://console.aw.tekflox.com/logout');
    expect(fetch).not.toHaveBeenCalled();
  });
});
